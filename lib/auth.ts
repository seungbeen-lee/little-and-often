export function getOwnerEmail(request: Request) {
  const email = request.headers.get("oai-authenticated-user-email")?.trim();
  return email || null;
}

export function unauthorized() {
  return Response.json(
    { error: "로그인 정보를 확인할 수 없습니다." },
    { status: 401 }
  );
}
