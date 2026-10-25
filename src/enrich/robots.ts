// robots.txt parsing and matching (RFC 9309) for the cited-page fetcher (SPEC M-2, §10).

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsPolicy {
  /** "full" = everything allowed, "none" = everything disallowed, "rules" = check `rules`. */
  kind: "full" | "none" | "rules";
  rules: RobotsRule[];
}

export const ALLOW_ALL: RobotsPolicy = { kind: "full", rules: [] };
export const DISALLOW_ALL: RobotsPolicy = { kind: "none", rules: [] };

/** Keeps the rules of the groups that apply to `agent` (our product token, e.g. "FieldCiteBot"). */
export function parseRobots(text: string, agent: string): RobotsPolicy {
  const token = agent.toLowerCase();
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let current: { agents: string[]; rules: RobotsRule[] } | null = null;
  let lastWasAgent = false;

  for (const raw of text.split(/\r?\n|\r/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      // An empty Disallow means "nothing is disallowed"; it adds no rule.
      if (current && value) current.rules.push({ allow: key === "allow", pattern: value });
    } else {
      lastWasAgent = false;
    }
  }

  // RFC 9309: the product token matches a user-agent line case-insensitively, as a whole token.
  const named = groups.filter((g) => g.agents.some((a) => a.split("/")[0].trim() === token));
  const chosen = named.length ? named : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules);
  return rules.length ? { kind: "rules", rules } : ALLOW_ALL;
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Normalizes percent-encoding so "/a%2fb" and "/a%2Fb" compare equal, as RFC 9309 asks. */
const normalizePath = (p: string) => p.replace(/%[0-9a-f]{2}/gi, (s) => s.toUpperCase());

/** `path` is the URL's path plus query, e.g. "/blog/post?x=1". The longest match wins; ties allow. */
export function isAllowed(policy: RobotsPolicy, path: string): boolean {
  if (policy.kind === "full") return true;
  if (policy.kind === "none") return false;
  if (path === "/robots.txt") return true;
  const target = normalizePath(path || "/");
  let best: RobotsRule | null = null;
  for (const rule of policy.rules) {
    if (!patternToRegex(normalizePath(rule.pattern)).test(target)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}
