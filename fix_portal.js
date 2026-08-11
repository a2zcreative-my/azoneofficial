const fs = require('fs');
let text = fs.readFileSync('app/portal/page.tsx', 'utf-8');
const oldText = `async function api<T>(path: string, init?: RequestInit) {
  try {
    const isMutating = init?.method && ["POST", "PUT", "PATCH", "DELETE"].includes(init.method);
    const csrfHeader = isMutating ? { "X-CSRF-Token": getCsrfToken() } : {};
    const res = await fetch(\`\${API}\${path}\`, {
      credentials: "include",
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...csrfHeader,
        ...(init?.headers as Record<string, string>),
      },
      ...init,
    });`;
    
const newText = `async function api<T>(path: string, init?: RequestInit) {
  try {
    const isMutating = init?.method && ["POST", "PUT", "PATCH", "DELETE"].includes(init.method);
    const headers = new Headers(init?.headers as Record<string, string> ?? {});
    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (isMutating) {
      const csrf = getCsrfToken();
      if (csrf) headers.set("X-CSRF-Token", csrf);
    }
    const res = await fetch(\`\${API}\${path}\`, {
      credentials: "include",
      ...init,
      headers,
    });`;
    
if (text.includes(oldText)) {
  fs.writeFileSync('app/portal/page.tsx', text.replace(oldText, newText));
} else {
  // Try CRLF
  const oldTextCRLF = oldText.replace(/\n/g, '\r\n');
  if (text.includes(oldTextCRLF)) {
    fs.writeFileSync('app/portal/page.tsx', text.replace(oldTextCRLF, newText.replace(/\n/g, '\r\n')));
  } else {
    console.log('Not found');
  }
}
