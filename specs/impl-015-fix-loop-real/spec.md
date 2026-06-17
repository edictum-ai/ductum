# impl-015 — Fix Loop Real

A spec used to drive the impl → review FAIL → fix → re-review → ship
loop on a real factory dispatch. The prompt deliberately under-spec'd
the helper so the round-1 implementation will likely miss edge cases
that the round-1 reviewer must flag.
