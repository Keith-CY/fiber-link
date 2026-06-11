/**
 * Fiber Link — Vanilla JS integration example.
 *
 * Uses @fiber-link/client in "signed" mode: the browser signs requests
 * directly with the HMAC secret. In production, prefer a server-side
 * proxy ("presigned" mode) to keep the secret out of the browser.
 *
 * This file imports the SDK from the local workspace path for development.
 * In a real project: import { FiberLinkClient } from "@fiber-link/client";
 */

// For local development without a bundler, inline the essential SDK subset.
// In a real project, import from the npm package instead.

function buildRequestId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function buildSignedHeaders(appId, secret, payload) {
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = buildRequestId().replace(/-/g, "").slice(0, 16);
  const message = `${ts}.${nonce}.${payload}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const signature = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return { "x-app-id": appId, "x-ts": ts, "x-nonce": nonce, "x-signature": signature };
}

async function rpcCall(endpoint, appId, secret, method, params) {
  const payload = JSON.stringify({ jsonrpc: "2.0", id: buildRequestId(), method, params });
  const authHeaders = await buildSignedHeaders(appId, secret, payload);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: payload,
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message ?? "RPC error");
  return body.result;
}

function setStatus(html, cls = "") {
  const el = document.getElementById("status");
  el.innerHTML = html;
  el.className = cls;
}

document.getElementById("tipBtn").addEventListener("click", async () => {
  const endpoint = document.getElementById("endpoint").value.trim();
  const appId    = document.getElementById("appId").value.trim();
  const secret   = document.getElementById("secret").value.trim();
  const postId   = document.getElementById("postId").value.trim();
  const fromUserId = document.getElementById("fromUserId").value.trim();
  const toUserId   = document.getElementById("toUserId").value.trim();
  const amount     = document.getElementById("amount").value.trim();

  if (!endpoint || !appId || !secret) {
    setStatus("Please fill in endpoint, app ID, and secret.", "error");
    return;
  }

  setStatus("Creating invoice…");

  try {
    const result = await rpcCall(endpoint, appId, secret, "tip.create", {
      postId, fromUserId, toUserId, amount, asset: "CKB",
    });

    const invoice = result?.invoice;
    if (!invoice) throw new Error("No invoice returned");

    setStatus(`Invoice created: <code>${invoice.slice(0, 40)}…</code><br/>Waiting for payment…`);

    // Try SSE first (requires /rpc/stream on the backend). EventSource cannot
    // set headers, so the app id rides along as a query param for the
    // backend's invoice-ownership check.
    const streamUrl =
      endpoint.replace(/\/rpc$/, "/rpc/stream") +
      `?invoice=${encodeURIComponent(invoice)}&appId=${encodeURIComponent(appId)}`;
    let sseHandled = false;

    if (typeof EventSource !== "undefined") {
      const es = new EventSource(streamUrl);
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.status === "SETTLED") {
            es.close();
            sseHandled = true;
            setStatus(`✓ Tip settled! Invoice: <code>${invoice.slice(0, 40)}…</code>`, "settled");
          } else if (data.status === "TIMEOUT" || data.status === "SSE_ERROR") {
            es.close();
          }
        } catch { /* ignore */ }
      };
      es.onerror = () => { es.close(); };
    }

    // Polling fallback (also covers the case when SSE isn't available).
    const pollInterval = setInterval(async () => {
      if (sseHandled) { clearInterval(pollInterval); return; }
      try {
        const statusResult = await rpcCall(endpoint, appId, secret, "tip.status", { invoice });
        if (statusResult?.state === "SETTLED") {
          clearInterval(pollInterval);
          setStatus(`✓ Tip settled! Invoice: <code>${invoice.slice(0, 40)}…</code>`, "settled");
        }
      } catch { /* retry next poll */ }
    }, 3000);

    // Auto-stop polling after 2 minutes.
    setTimeout(() => clearInterval(pollInterval), 120_000);

  } catch (e) {
    setStatus(`Error: ${e.message}`, "error");
  }
});
