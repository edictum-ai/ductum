# Tool Examples Convention

Generated from ductum.authoring-contract.v1. Do not edit by hand.

Each agent-visible MCP tool must have 1-5 examples in the authoring contract.
Examples must show only public tool inputs. Do not include run_id, operator tokens, cookies, secrets, or local absolute paths.

Current tool example index:

- ductum.workflow: {}
- ductum.gate_check: {}
- ductum.next_task: {}
- ductum.accept: {"task_id":"task_123"}
- ductum.get_context: {"task_id":"task_123"}
- ductum.update: {"message":"Implemented parser changes; running tests next."}
- ductum.heartbeat: {}
- ductum.decide: {"decision":"Keep the parser strict","context":"Loose parsing would hide invalid specs."}
- ductum.evidence: {"type":"test","payload":{"command":"pnpm test","passed":true}}
- ductum.link: {"branch":"feat/example","commit":"abc1234"}
- ductum.complete: {"result":"Implemented the parser fix, added regression coverage, and ran the requested test suite."}
- ductum.fail: {"reason":"Cannot continue because required credentials are missing.","recoverable":false}
