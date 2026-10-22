// Build-time guard for the native values written by the local Settings and close patches.
import CloudKit

precondition(CKAccountStatus.couldNotDetermine.rawValue == 0)
var localCloseID = "arcmod-local"
let expectedLocalID: [UInt8] = Array(localCloseID.utf8) + [0, 0, 0, 0xec]
precondition(MemoryLayout<String>.size == 16)
precondition(withUnsafeBytes(of: &localCloseID) { Array($0) } == expectedLocalID)
print("CloudKit status and local close String ABI: verified")
