# UI kit rules

For changes here, follow the [internal control extension workflow](../../../docs/ui-architecture.md#修改默认组件或增加内部复合控件).
When changing semantic interfaces, keep props, the runtime proxy, exports, and every registered adapter consistent.
For default ak-ui visuals or interactions, follow the [current spec](../../../docs/design/ak-ui-current-spec.md),
including its current desktop scope, precedence over generic skill defaults, role-specific density, and token ownership.

Before changing shared controls or styles, identify external presentation consumers
and default-inheritance paths. Internal adapter members are distinct from public
Presentation surfaces; extending one does not automatically extend the other.
