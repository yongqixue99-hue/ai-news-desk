export const interleaveBySource = <T>(items: T[], sourceFor: (item: T) => string): T[] => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const source = sourceFor(item).trim().toLocaleLowerCase() || "unknown-source";
    const group = groups.get(source) ?? [];
    group.push(item);
    groups.set(source, group);
  }

  const diversified: T[] = [];
  const rounds = Math.max(0, ...[...groups.values()].map((group) => group.length));
  for (let round = 0; round < rounds; round += 1) {
    for (const group of groups.values()) {
      const item = group[round];
      if (item) diversified.push(item);
    }
  }
  return diversified;
};
