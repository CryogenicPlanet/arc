// Build-time guard for the compact Storable patch's resilient Foundation value.
import Foundation
import CloudKit

var empty = JSONEncoder.OutputFormatting(rawValue: 0)
var pretty = JSONEncoder.OutputFormatting.prettyPrinted
precondition(MemoryLayout<JSONEncoder.OutputFormatting>.size == 8)
precondition(MemoryLayout<JSONEncoder.OutputFormatting>.stride == 8)
precondition(withUnsafeBytes(of: &empty) { Array($0) } == Array(repeating: UInt8(0), count: 8))
precondition(withUnsafeBytes(of: &pretty) { Array($0) } == [1, 0, 0, 0, 0, 0, 0, 0])
let encoder = JSONEncoder()
encoder.outputFormatting = empty
let input = ["state": [1, 2, 3]]
let encoded = try encoder.encode(input)
precondition(!encoded.contains(10))
let decoded = try JSONDecoder().decode([String: [Int]].self, from: encoded)
precondition(decoded == input)
precondition(CKAccountStatus.couldNotDetermine.rawValue == 0)
print("Foundation formatting ABI, compact JSON round-trip and unavailable CloudKit status: verified")
