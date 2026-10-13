// Writes every non-external function as "entry \t end \t size \t name" (sorted by entry),
// used by tools/symbolicate.ts to map profiler addresses to functions.
// Usage: -postScript ExportFunctions.java /abs/path/functions.tsv
// @category Arc

import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;

import java.io.BufferedWriter;
import java.nio.file.Files;
import java.nio.file.Path;

public class ExportFunctions extends GhidraScript {
	@Override
	protected void run() throws Exception {
		Path out = Path.of(getScriptArgs()[0]);
		int n = 0;
		try (BufferedWriter w = Files.newBufferedWriter(out)) {
			FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
			while (it.hasNext() && !monitor.isCancelled()) {
				Function f = it.next();
				if (f.isExternal()) continue;
				long entry = f.getEntryPoint().getOffset();
				long end = f.getBody().getMaxAddress().getOffset() + 1;
				w.write(String.format("0x%x\t0x%x\t%d\t%s%n", entry, end, end - entry, f.getName(true)));
				n++;
			}
		}
		println("ExportFunctions: wrote " + n + " functions to " + out);
	}
}
