# Add Tambo to an existing app

This guide covers integrating Tambo into a React app (Next.js / Vite / Expo).

## 1. Install

```bash
npx tambo full-send
```

This command:

- Sets up Tambo and gets you an API key
- Detects your framework and configures the build toolchain
- Installs pre-built chat components
- Shows how to wrap your app with `TamboProvider`

For manual setup, run `npx tambo init` instead (just the API key). If you don't have an account, [sign up free](https://console.tambo.co).

## 2. Add the provider

### Next.js

`src/app/layout.tsx`

```tsx
"use client";

import { TamboProvider } from "@tambo-ai/react";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <TamboProvider
      apiKey={process.env.NEXT_PUBLIC_TAMBO_API_KEY!}
      userKey="user-1"
    >
      {children}
    </TamboProvider>
  );
}
```

API key setup:

```bash
NEXT_PUBLIC_TAMBO_API_KEY=tambo_NLsM1xDHHkIG5r+i+2ipxITew1Fy24pzBtF1jCr0L8RcBgN8+vHPc/Yomli7TRlCV1j1Ov8hIyrVCytFK9jlFJT9o1jMZWIKIjtUWQvX0Mk=
```

> Do not commit `.env.local` to version control.

### Vite

`src/App.tsx`

```tsx
import { TamboProvider } from "@tambo-ai/react";

export default function App() {
  return (
    <TamboProvider
      apiKey={import.meta.env.VITE_TAMBO_API_KEY!}
      userKey="user-1"
    >
      {/* your app content */}
    </TamboProvider>
  );
}
```

API key setup:

```bash
VITE_TAMBO_API_KEY=tambo_NLsM1xDHHkIG5r+i+2ipxITew1Fy24pzBtF1jCr0L8RcBgN8+vHPc/Yomli7TRlCV1j1Ov8hIyrVCytFK9jlFJT9o1jMZWIKIjtUWQvX0Mk=
```

### Expo

`App.tsx`

```tsx
import { TamboProvider } from "@tambo-ai/react";

export default function App() {
  return (
    <TamboProvider
      apiKey={process.env.EXPO_PUBLIC_TAMBO_API_KEY!}
      userKey="user-1"
    >
      {/* your app content */}
    </TamboProvider>
  );
}
```

API key setup:

```bash
EXPO_PUBLIC_TAMBO_API_KEY=tambo_NLsM1xDHHkIG5r+i+2ipxITew1Fy24pzBtF1jCr0L8RcBgN8+vHPc/Yomli7TRlCV1j1Ov8hIyrVCytFK9jlFJT9o1jMZWIKIjtUWQvX0Mk=
```

> Expo native: registry components (DOM + Tailwind) will not work in React Native. Use `@tambo-ai/react` hooks directly.

## 3. Add the chat component

### Next.js

`src/app/page.tsx`

```tsx
"use client";
import { MessageThreadCollapsible } from "../source/components/message-thread-collapsible";

export default function Home() {
  return (
    <main>
      <MessageThreadCollapsible />
    </main>
  );
}
```

### Vite

`src/App.tsx`

```tsx
import { MessageThreadCollapsible } from "./components/tambo/message-thread-collapsible";

export default function App() {
  return (
    <main>
      <MessageThreadCollapsible />
    </main>
  );
}
```

## 4. Run

```bash
npm run dev
```

## Next steps

- Register components: `/concepts/generative-interfaces/generative-components`
- Add tools: `/concepts/tools`
- Connect MCP servers: `/concepts/model-context-protocol`
