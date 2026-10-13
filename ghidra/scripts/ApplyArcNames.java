// Applies dump/symbol-map.tsv (addr \t source \t name) to the program: creates a
// function at each address that lacks one and sets it as the primary label.
// Usage: -postScript ApplyArcNames.java /abs/path/symbol-map.tsv
// @category Arc

import ghidra.app.cmd.function.CreateFunctionCmd;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.SourceType;
import ghidra.program.model.symbol.Symbol;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

public class ApplyArcNames extends GhidraScript {
	private static String sanitize(String name) {
		// Ghidra labels disallow whitespace; keep the rest readable.
		return name.replaceAll("\\s+", "_");
	}

	@Override
	protected void run() throws Exception {
		Path tsv = Path.of(getScriptArgs()[0]);
		List<String> lines = Files.readAllLines(tsv);
		int renamed = 0, created = 0, failed = 0;
		for (String line : lines) {
			String[] cols = line.split("\t", 3);
			if (cols.length < 3) continue;
			Address addr = toAddr(Long.parseUnsignedLong(cols[0].substring(2), 16));
			if (!currentProgram.getMemory().contains(addr)) { failed++; continue; }
			Function fn = getFunctionAt(addr);
			if (fn == null) {
				CreateFunctionCmd cmd = new CreateFunctionCmd(addr);
				if (cmd.applyTo(currentProgram, monitor)) { fn = getFunctionAt(addr); created++; }
			}
			String name = sanitize(cols[2]);
			try {
				if (fn != null) {
					fn.setName(name, SourceType.IMPORTED);
				} else {
					Symbol s = createLabel(addr, name, true, SourceType.IMPORTED);
					if (s == null) { failed++; continue; }
				}
				renamed++;
			} catch (Exception e) {
				failed++;
			}
		}
		println(String.format("ApplyArcNames: renamed=%d created=%d failed=%d", renamed, created, failed));
	}
}
