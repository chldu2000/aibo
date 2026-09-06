# App component rules

- Treat these components as presentation and event-forwarding boundaries.
- Consume primitives and composite visual controls through `$lib/ui-kit`.
- Do not import concrete shadcn, Material, Lucide, Material Symbols, or other
  UI implementations here.
- Do not add a `<style>` block containing visual declarations. Layout-only
  declarations are allowed; put skin-dependent appearance in
  `src/lib/ui-kit/kits/<skin>/`.
- Receive business state through props and emit user intent through callbacks.
