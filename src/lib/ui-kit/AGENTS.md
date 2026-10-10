# UI kit rules

For changes here, follow the [internal control extension workflow](../../../docs/ui-architecture.md#修改默认组件或增加内部复合控件).
When changing semantic interfaces, keep props, the runtime proxy, exports, and every registered adapter consistent.
For the default Material 3 kit, follow the [current Material 3 spec](../../../docs/design/material3-current-spec.md).
For the optional ak-ui kit, follow the [current ak-ui spec](../../../docs/design/ak-ui-current-spec.md),
including its current desktop scope, precedence over generic skill defaults, role-specific density, and token ownership.

Before changing shared controls or styles, identify external presentation consumers
and default-inheritance paths. Internal adapter members are distinct from public
Presentation surfaces; extending one does not automatically extend the other.

Panels follow the [panel information architecture](../../../docs/ui-architecture.md#面板信息架构): actions only in
toolbars, heading slots, row actions or footers; at most two visible heading levels; no new feature-named skin selectors.
Plugin tool views receive tokens through the [visual contract](../../../docs/tool-view-contract.md#visual-contract).
