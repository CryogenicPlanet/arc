// Session identity is deliberately independent of the selected Arc window or Space.
export const agentSlugPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export const validateAgentSlug = (slug: string): string => {
  if (slug.length > 32 || !agentSlugPattern.test(slug)) {
    throw new Error("agent slug must be 1-32 lowercase letters/digits with internal hyphens, starting with a letter");
  }
  return slug;
};

export interface SessionIdentity {
  readonly appName: string;
  readonly bundleId: string;
  readonly displayName: string;
  readonly agent: string | undefined;
}

export const sessionIdentity = (validation = false, agent?: string): SessionIdentity => {
  if (validation && agent !== undefined) throw new Error("--validation and --agent cannot be combined");
  if (agent !== undefined) {
    validateAgentSlug(agent);
    return {
      appName: `ArcModAgent-${agent}`,
      bundleId: `company.thebrowser.Browser.mod.agent.${agent}`,
      displayName: `Arc Mod · ${agent}`,
      agent,
    };
  }
  return {
    appName: validation ? "ArcModValidation" : "ArcMod",
    bundleId: validation ? "company.thebrowser.Browser.mod.validation" : "company.thebrowser.Browser.mod",
    displayName: validation ? "Arc Mod Test" : "Arc Mod",
    agent: undefined,
  };
};

export interface BuildOptions {
  readonly source: string;
  readonly session: SessionIdentity;
  // An ArcCore.framework to use instead of the source app's own engine (e.g. one built from Chromium).
  readonly engine?: string;
}

export const parseBuildOptions = (args: readonly string[]): BuildOptions => {
  let source = "/Applications/Arc.app";
  let validation = false;
  let agent: string | undefined;
  let engine: string | undefined;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;
    if (!["--source", "--validation", "--agent", "--engine"].includes(flag)) throw new Error(`unrecognized build argument: ${flag}`);
    if (seen.has(flag)) throw new Error(`duplicate build argument: ${flag}`);
    seen.add(flag);
    if (flag === "--validation") {
      validation = true;
      continue;
    }
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${flag}`);
    if (flag === "--source") source = value;
    else if (flag === "--engine") engine = value;
    else agent = validateAgentSlug(value);
  }
  const session = sessionIdentity(validation, agent);
  return engine === undefined ? { source, session } : { source, session, engine };
};
