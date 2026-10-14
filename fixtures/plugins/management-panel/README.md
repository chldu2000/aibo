# Management panel declaration fixture

This manifest validates two session providers sharing one static management panel.
It is a declaration fixture, not an installable executable package: no worker is shipped.
Rust and JavaScript tests validate local references and scopes. The browser probe supplies
in-memory settings ports to exercise both forms without credentials or Agent processes.
