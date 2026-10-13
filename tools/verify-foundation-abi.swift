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
var localCloseID = "arcmod-local"
let expectedLocalID: [UInt8] = Array(localCloseID.utf8) + [0, 0, 0, 0xec]
precondition(MemoryLayout<String>.size == 16)
precondition(withUnsafeBytes(of: &localCloseID) { Array($0) } == expectedLocalID)
print("Foundation formatting ABI, compact JSON, CloudKit status and local close String ABI: verified")
