// Read-only benchmark of JSONEncoder/JSONDecoder formatting using existing Arc stores.
// Run: xcrun swift -O /tmp/arc-foundation-storage-benchmark.swift [data-directory]
// Emits aggregate file sizes and median timings only; never writes stores or prints values.
// The recursive Codable model represents the source shape, not Arc's concrete model types.
import Foundation

indirect enum JSONValue: Codable, Equatable {
    case null, bool(Bool), int(Int64), double(Double), string(String)
    case array([JSONValue]), object([String: JSONValue])

    struct Key: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
    }

    init(from decoder: Decoder) throws {
        if let container = try? decoder.container(keyedBy: Key.self) {
            var dictionary: [String: JSONValue] = [:]
            for key in container.allKeys {
                dictionary[key.stringValue] = try container.decode(JSONValue.self, forKey: key)
            }
            self = .object(dictionary)
            return
        }
        if var container = try? decoder.unkeyedContainer() {
            var array: [JSONValue] = []
            while !container.isAtEnd { array.append(try container.decode(JSONValue.self)) }
            self = .array(array)
            return
        }
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Int64.self) { self = .int(value) }
        else if let value = try? container.decode(Double.self) { self = .double(value) }
        else { self = .string(try container.decode(String.self)) }
    }

    func encode(to encoder: Encoder) throws {
        switch self {
        case .object(let dictionary):
            var container = encoder.container(keyedBy: Key.self)
            for (key, value) in dictionary {
                try container.encode(value, forKey: Key(stringValue: key)!)
            }
        case .array(let array):
            var container = encoder.unkeyedContainer()
            for value in array { try container.encode(value) }
        default:
            var container = encoder.singleValueContainer()
            switch self {
            case .null: try container.encodeNil()
            case .bool(let value): try container.encode(value)
            case .int(let value): try container.encode(value)
            case .double(let value): try container.encode(value)
            case .string(let value): try container.encode(value)
            default: break
            }
        }
    }
}

func median(_ values: [Double]) -> Double {
    let sorted = values.sorted()
    return sorted[sorted.count / 2]
}
func now() -> UInt64 { DispatchTime.now().uptimeNanoseconds }

let names = [
    "StorableSidebar.json", "StorableArchiveItems.json",
    "StorableCommandBarAdditionalRanking.json", "StorableLiveData.json",
    "StorableWindows.json",
]
let base = CommandLine.arguments.count > 1
    ? URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    : FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/Arc", isDirectory: true)
let decoder = JSONDecoder()
let pretty = JSONEncoder()
pretty.outputFormatting = .prettyPrinted
let compact = JSONEncoder()
compact.outputFormatting = []
var sourceTotal = 0
var prettyTotal = 0
var compactTotal = 0

print("Foundation JSON formatting surrogate; n=11 medians, warmups=2, formats interleaved; disk IO excluded")
for name in names {
    guard let source = try? Data(contentsOf: base.appendingPathComponent(name)) else {
        print("\(name) unavailable")
        continue
    }
    do {
        let value = try decoder.decode(JSONValue.self, from: source)
        let prettyData = try pretty.encode(value)
        let compactData = try compact.encode(value)
        guard try decoder.decode(JSONValue.self, from: prettyData) == value,
              try decoder.decode(JSONValue.self, from: compactData) == value else {
            print("\(name) semantic round-trip mismatch; timings skipped")
            continue
        }
        for _ in 0..<2 {
            _ = try pretty.encode(value)
            _ = try compact.encode(value)
            _ = try decoder.decode(JSONValue.self, from: prettyData)
            _ = try decoder.decode(JSONValue.self, from: compactData)
        }
        var prettyEncode: [Double] = [], compactEncode: [Double] = []
        var prettyDecode: [Double] = [], compactDecode: [Double] = []
        for iteration in 0..<11 {
            let formats = iteration.isMultiple(of: 2)
                ? [(pretty, prettyData, true), (compact, compactData, false)]
                : [(compact, compactData, false), (pretty, prettyData, true)]
            for (encoder, data, isPretty) in formats {
                let encodeStart = now()
                let encoded = try encoder.encode(value)
                let encodeTime = Double(now() - encodeStart) / 1e6
                let decodeStart = now()
                let decoded = try decoder.decode(JSONValue.self, from: data)
                let decodeTime = Double(now() - decodeStart) / 1e6
                precondition(!encoded.isEmpty && decoded == value)
                if isPretty {
                    prettyEncode.append(encodeTime)
                    prettyDecode.append(decodeTime)
                } else {
                    compactEncode.append(encodeTime)
                    compactDecode.append(decodeTime)
                }
            }
        }
        sourceTotal += source.count
        prettyTotal += prettyData.count
        compactTotal += compactData.count
        print(String(
            format: "%@ source=%d pretty=%d compact=%d saved=%.1f%% encode_ms(pretty/compact)=%.3f/%.3f decode_ms(pretty/compact)=%.3f/%.3f semantics=equal",
            name, source.count, prettyData.count, compactData.count,
            100 * (1 - Double(compactData.count) / Double(prettyData.count)),
            median(prettyEncode), median(compactEncode), median(prettyDecode), median(compactDecode)
        ))
    } catch {
        print("\(name) benchmark failed (details suppressed)")
    }
}
if prettyTotal > 0 {
    print(String(format: "total source=%d pretty=%d compact=%d saved=%.1f%%",
        sourceTotal, prettyTotal, compactTotal, 100 * (1 - Double(compactTotal) / Double(prettyTotal))))
}
