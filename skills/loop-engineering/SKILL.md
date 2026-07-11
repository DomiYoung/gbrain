---
name: loop-engineering
version: 1.0.0
description: |
  Loop engineering patterns and maker-checker loop design. Based on Boris Cherny's
  approach to writing robust loops with clear entry/exit conditions, invariants,
  and validation.
triggers:
  - loop engineering
  - boris cherny
  - write loops
  - loop design
  - maker checker loop
tools:
  - read_file
  - write_file
  - patch
mutating: true
---

# Loop Engineering

Design robust loops with clear entry/exit conditions, invariants, and validation.

## Core Principles

1. **Entry Conditions**: What must be true before the loop starts?
2. **Loop Invariants**: What must remain true on every iteration?
3. **Exit Conditions**: What causes the loop to terminate?
4. **Progress Guarantee**: Each iteration must move toward termination

## Maker-Checker Pattern

```typescript
// Maker: generate candidates
const candidates = makeCandidates();

// Checker: validate each
for (const candidate of candidates) {
  if (checker(candidate)) {
    apply(candidate);
  }
}
```

## Anti-Patterns

- Unbounded loops without timeout
- Missing progress guarantee
- Side effects that violate invariants
- Exit conditions that can never be reached

## Usage

When writing loops:
1. State entry conditions explicitly
2. Document loop invariants
3. Prove progress on each iteration
4. Add timeout or max-iteration guard
