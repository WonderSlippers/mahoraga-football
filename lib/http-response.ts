export async function discardResponse(response:Response|null|undefined) {
  try { await response?.body?.cancel(); } catch { /* The connection is already closed or the body is locked. */ }
}

export async function requireOk(response:Response,label="") {
  if(response.ok)return response;
  const status=response.status;
  await discardResponse(response);
  throw new Error(`${label?label+" ":""}HTTP ${status}`);
}

