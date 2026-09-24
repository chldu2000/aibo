# App component rules

For changes here, follow the [UI layer and dependency rules](../../../../docs/ui-architecture.md#分层与依赖方向).
Receive business state through props and emit semantic user intent through callbacks.
Put shared state and asynchronous business operations in host-owned controllers.
