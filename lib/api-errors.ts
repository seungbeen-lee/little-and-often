export function toApiError(error: unknown) {
  const message = error instanceof Error ? error.message : "알 수 없는 오류";
  const detail =
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : "";
  const combined = `${message}\n${detail}`;

  if (combined.includes("no such table")) {
    return "저장 공간을 준비하는 중입니다. 잠시 후 다시 시도해 주세요.";
  }

  return message;
}
