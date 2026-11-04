import { env } from "cloudflare:workers";
import { getOwnerEmail, unauthorized } from "../../../lib/auth";
import { importedTable, tableImportRequest } from "../../../lib/table-import";

// Secrets are supplied only by the server runtime; never by a browser request.
export async function POST(request: Request) {
  if (!getOwnerEmail(request)) return unauthorized();
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 12_000_000) return Response.json({error:"사진은 8MB 이하로 올려 주세요."},{status:413});
    const body = await request.text();
    if (body.length > 12_000_000) return Response.json({error:"사진은 8MB 이하로 올려 주세요."},{status:413});
    const {image} = JSON.parse(body);
    if (typeof image !== "string" || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(image)) return Response.json({error:"PNG, JPEG, WebP 사진을 선택해 주세요."},{status:400});
    const key = (env as unknown as Record<string,string>).OPENAI_API_KEY;
    if (!key) return Response.json({error:"사진 인식 연결이 아직 준비되지 않았어요. 수동 표 편집은 사용할 수 있어요."},{status:503});
    const response = await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify(tableImportRequest(image)),signal:AbortSignal.timeout(100_000)});
    if (!response.ok) return Response.json({error:response.status===429?"사진 인식 사용량 또는 잔액을 확인해 주세요. 잠시 뒤 다시 시도할 수도 있어요.":"사진을 인식하지 못했어요. 연결 설정을 확인하거나 잠시 뒤 다시 시도해 주세요."},{status:502});
    const result = await response.json() as {status?:string;output?:Array<{content?:Array<{type:string;text?:string}>}>};
    if (result.status !== "completed") throw new Error("incomplete");
    const text = result.output?.flatMap((item)=>item.content??[]).filter((item)=>item.type==="output_text").map((item)=>item.text??"").join("") ?? "";
    return Response.json({table:importedTable(JSON.parse(text))});
  } catch {
    return Response.json({error:"변환 결과를 완성하지 못했어요. 표 부분만 잘라 다시 시도하거나 수동으로 입력해 주세요. 기존 내용은 그대로예요."},{status:502});
  }
}
