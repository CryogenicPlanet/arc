// Decompiles every non-external, non-thunk function in parallel and writes C pseudocode
// sharded by 1MB address range: <outDir>/0x1004.c holds functions in [0x100400000, 0x100500000).
// Usage: -postScript DecompileAll.java /abs/path/outDir [timeoutSeconds]
// @category Arc

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.decompiler.parallel.DecompilerCallback;
import ghidra.app.decompiler.parallel.ParallelDecompiler;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.util.task.TaskMonitor;

import java.io.BufferedWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentSkipListMap;
import java.util.concurrent.atomic.AtomicInteger;

public class DecompileAll extends GhidraScript {
	private record Out(long entry, String name, long size, String c) {}

	@Override
	protected void run() throws Exception {
		String[] args = getScriptArgs();
		Path outDir = Path.of(args[0]);
		int timeout = args.length > 1 ? Integer.parseInt(args[1]) : 60;
		Files.createDirectories(outDir);

		List<Function> fns = new ArrayList<>();
		Iterator<Function> it = currentProgram.getFunctionManager().getFunctions(true);
		while (it.hasNext()) {
			Function f = it.next();
			if (!f.isExternal() && !f.isThunk()) fns.add(f);
		}
		println("DecompileAll: " + fns.size() + " functions, timeout " + timeout + "s");

		AtomicInteger done = new AtomicInteger(), failed = new AtomicInteger();
		ConcurrentSkipListMap<Long, Out> results = new ConcurrentSkipListMap<>();
		DecompilerCallback<Out> cb = new DecompilerCallback<>(currentProgram, (DecompInterface d) -> {
			DecompileOptions o = new DecompileOptions();
			o.grabFromProgram(currentProgram);
			d.setOptions(o);
			d.toggleCCode(true);
			d.toggleSyntaxTree(false);
			d.setSimplificationStyle("decompile");
		}) {
			@Override
			public Out process(DecompileResults r, TaskMonitor m) {
				Function f = r.getFunction();
				long entry = f.getEntryPoint().getOffset();
				long size = f.getBody().getNumAddresses();
				String c = r.decompileCompleted() && r.getDecompiledFunction() != null
					? r.getDecompiledFunction().getC()
					: "/* decompile failed: " + r.getErrorMessage() + " */\n";
				if (!r.decompileCompleted()) failed.incrementAndGet();
				int n = done.incrementAndGet();
				if (n % 5000 == 0) println("DecompileAll: " + n + "/" + fns.size());
				return new Out(entry, f.getName(true), size, c);
			}
		};
		cb.setTimeout(timeout);
		try {
			ParallelDecompiler.decompileFunctions(cb, currentProgram, fns.iterator(),
				(Out o) -> { if (o != null) results.put(o.entry(), o); }, monitor);
		} finally {
			cb.dispose();
		}

		Map<Long, List<Out>> shards = new TreeMap<>();
		results.values().forEach(o -> shards.computeIfAbsent(o.entry() >>> 20, k -> new ArrayList<>()).add(o));
		for (Map.Entry<Long, List<Out>> shard : shards.entrySet()) {
			Path file = outDir.resolve(String.format("0x%x.c", shard.getKey()));
			try (BufferedWriter w = Files.newBufferedWriter(file)) {
				for (Out o : shard.getValue()) {
					w.write(String.format("// ==== 0x%x  %s  (%d bytes)%n", o.entry(), o.name(), o.size()));
					w.write(o.c());
					w.write("\n");
				}
			}
		}
		println(String.format("DecompileAll: done=%d failed=%d shards=%d -> %s",
			done.get(), failed.get(), shards.size(), outDir));
	}
}
