# App component rules

For changes here, follow the [UI layer and dependency rules](../../../../docs/ui-architecture.md#分层与依赖方向).
Receive business state through props and emit semantic user intent through callbacks.
Put shared state and asynchronous business operations in host-owned controllers.
Before adding or changing a panel or settings section, read the
[panel and settings information architecture](../../../../docs/ui-architecture.md#面板与设置信息架构):
compose `$lib/ui-kit` components (Tabs, SegmentedControl, SettingsSection, ManagementDataView, …)
instead of borrowing `settings-*` / `appearance-*` class names or restyling `Button` variants.
