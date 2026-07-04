const allowedTypes = [
  "feat",
  "fix",
  "docs",
  "refactor",
  "test",
  "chore",
  "ci",
  "build",
  "perf",
];

module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "header-max-length": [2, "always", 90],
    "scope-empty": [0],
    "type-enum": [2, "always", allowedTypes],
  },
};
