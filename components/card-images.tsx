"use client";

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent } from "react";
import { Crop, ImagePlus, LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { MAX_FIELD_IMAGES, MAX_IMAGE_BYTES, MEDIA_FIELDS, normalizeCrop, type CardImage, type CardMedia, type ImageCrop, type MediaField } from "@/lib/card-media";
import { captureTextFocus, restoreTextFocus, type TextFocus } from "@/lib/editor-focus";

export function useImageUploadGuard() {
  const count = useRef(0);
  const [uploading, setUploading] = useState(false);
  const onBusyChange = useCallback((busy: boolean) => {
    count.current = Math.max(0, count.current + (busy ? 1 : -1));
    setUploading(count.current > 0);
  }, []);
  return { uploading, uploadCount: count, onBusyChange };
}

type PhotoRequest = { image: CardImage; onChange?: (image: CardImage) => void; onRemove?: () => void; focus?: TextFocus | null };
const PhotoContext = createContext<(request: PhotoRequest) => void>(() => {});

// One foreground layer, outside card buttons and selection rows, prevents click bubbling.
export function PhotoViewerProvider({ children }: { children: ReactNode }) {
  const [photo, setPhoto] = useState<PhotoRequest | null>(null);
  useEffect(() => {
    // Photo layers can sit above a separately mounted preview. Consume Escape
    // before that preview's primitive or the underlying study shortcuts see it.
    const closeTopPhoto = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (!dismissPhotoLayer()) return;
      event.preventDefault(); event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", closeTopPhoto, true);
    return () => window.removeEventListener("keydown", closeTopPhoto, true);
  }, []);
  return <PhotoContext.Provider value={setPhoto}>{children}{photo && <PhotoDialog photo={photo} onClose={() => setPhoto(null)} />}</PhotoContext.Provider>;
}

export function isPhotoInteraction(target: EventTarget | null) {
  return target instanceof Element && !!target.closest("[data-card-photo], [data-table-interaction], .table-register-button, .photo-attach-trigger, .card-preview-trigger");
}

export function dismissPhotoLayer() {
  const back = [...document.querySelectorAll<HTMLButtonElement>("[data-photo-back]")]
    .sort((a, b) => Number(a.dataset.photoBack) - Number(b.dataset.photoBack)).at(-1);
  if (!back) return false;
  back.click();
  return true;
}

function AttachmentImage({ image, label = "첨부 사진" }: { image: CardImage; label?: string }) {
  const [failed, setFailed] = useState(false);
  const [ratio, setRatio] = useState<number | null>(null);
  const crop = normalizeCrop(image.crop);
  return failed ? <span className="image-load-error" role="status">사진을 불러오지 못했어요. 연결을 확인한 뒤 다시 열어 주세요.</span>
    : <span className={`attachment-image${crop && ratio ? " is-cropped" : ""}`} style={crop && ratio ? { aspectRatio: ratio * crop.width / crop.height } : undefined}>
      <img src={`/api/images/${image.id}`} alt={image.alt || label} loading="lazy" decoding="async" draggable={false}
        onLoad={(event) => setRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)} onError={() => setFailed(true)}
        style={crop && ratio ? { width: `${100 / crop.width}%`, left: `${-100 * crop.x / crop.width}%`, top: `${-100 * crop.y / crop.height}%` } : undefined} />
    </span>;
}

export function CardImages({ images = [], position }: { images?: CardImage[]; position?: CardImage["position"] }) {
  const openPhoto = useContext(PhotoContext);
  if (!images.length || position === "before") return null;
  // Phrasing markup remains valid inside the existing question / answer buttons.
  return <span className="card-images">{images.map((image) => <span className="card-image" key={image.id}>
    <span data-card-photo role="button" tabIndex={-1} className="card-image-open" aria-label="사진 확대" title="사진 확대"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); openPhoto({ image }); }}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); openPhoto({ image }); } }}>
      <AttachmentImage image={image} />
    </span>
    {image.alt && <span className="card-image-caption">{image.alt}</span>}
  </span>)}</span>;
}

const wholeImage: ImageCrop = { x: 0, y: 0, width: 1, height: 1 };
type CropDrag = { x: number; y: number; crop: ImageCrop; handle: string };
function CropSurface({ image, crop, onChange }: { image: CardImage; crop: ImageCrop; onChange: (crop: ImageCrop) => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<CropDrag | null>(null);
  const [ratio, setRatio] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  function point(event: PointerEvent) {
    const rect = stage.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  }
  function move(event: PointerEvent) {
    const origin = drag.current;
    if (!origin) return;
    const p = point(event), dx = p.x - origin.x, dy = p.y - origin.y, c = origin.crop;
    if (origin.handle === "move") {
      onChange({ ...c, x: Math.max(0, Math.min(1 - c.width, c.x + dx)), y: Math.max(0, Math.min(1 - c.height, c.y + dy)) });
      return;
    }
    let left = c.x, right = c.x + c.width, top = c.y, bottom = c.y + c.height;
    if (origin.handle === "draw") { left = Math.min(origin.x, p.x); right = Math.max(origin.x, p.x); top = Math.min(origin.y, p.y); bottom = Math.max(origin.y, p.y); }
    else {
      if (origin.handle.includes("w")) left = Math.max(0, Math.min(right - .02, c.x + dx));
      if (origin.handle.includes("e")) right = Math.min(1, Math.max(left + .02, c.x + c.width + dx));
      if (origin.handle.includes("n")) top = Math.max(0, Math.min(bottom - .02, c.y + dy));
      if (origin.handle.includes("s")) bottom = Math.min(1, Math.max(top + .02, c.y + c.height + dy));
    }
    onChange(normalizeCrop({ x: left, y: top, width: right - left, height: bottom - top }) ?? wholeImage);
  }
  return <div className="image-crop-area">
    {failed ? <p role="alert">사진을 불러오지 못했어요. 닫고 다시 시도해 주세요.</p> : <div ref={stage} data-mobile-back-swipe-ignore className={`image-crop-stage${loaded ? " is-loaded" : ""}`} style={{ aspectRatio: ratio, width: `min(100%, calc(58dvh * ${ratio}))` }}
      onPointerDown={(event) => {
        if (!loaded || event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        const p = point(event), target = event.target as Element;
        drag.current = { ...p, crop, handle: target.closest<HTMLElement>("[data-crop-handle]")?.dataset.cropHandle ?? (target.closest(".image-crop-selection") ? "move" : "draw") };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={move} onPointerUp={(event) => { move(event); drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { drag.current = null; }}>
      <img src={`/api/images/${image.id}`} alt="자를 원본 사진" draggable={false} onLoad={(event) => { setRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight); setLoaded(true); }} onError={() => setFailed(true)} />
      {loaded && <div className="image-crop-selection" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}>
        <span className="image-crop-grid" />{["nw", "ne", "sw", "se"].map((handle) => <span key={handle} data-crop-handle={handle} className={`image-crop-handle is-${handle}`} />)}
      </div>}
    </div>}
  </div>;
}

function PhotoDialog({ photo, onClose }: { photo: PhotoRequest; onClose: () => void }) {
  const [image, setImage] = useState(photo.image);
  const [cropping, setCropping] = useState(false);
  const [crop, setCrop] = useState<ImageCrop>(image.crop ?? wholeImage);
  const [removing, setRemoving] = useState(false);
  function applyCrop() {
    const next = { ...image, width: 100, align: "center" as const, position: "after" as const, crop: normalizeCrop(crop) };
    photo.onChange?.(next); setImage(next); setCropping(false);
  }
  return <>
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="photo-lightbox-dialog" overlayClassName="photo-lightbox-overlay"
        onCloseAutoFocus={(event) => { if (photo.focus) { event.preventDefault(); restoreTextFocus(photo.focus); } }}
        onEscapeKeyDown={(event) => { if (cropping) { event.preventDefault(); setCropping(false); } }}>
        <button type="button" hidden tabIndex={-1} data-photo-back="121" onClick={() => cropping ? setCropping(false) : onClose()} />
        <DialogHeader className="pr-8 text-left"><DialogTitle>{cropping ? "사진 자르기" : "사진"}</DialogTitle><DialogDescription className={cropping ? "" : "sr-only"}>{cropping ? "모서리를 움직여 범위를 정하세요. 원본은 그대로 남아요." : "확대된 사진"}</DialogDescription></DialogHeader>
        {cropping ? <CropSurface image={image} crop={crop} onChange={setCrop} /> : <div className="photo-lightbox-scroll"><AttachmentImage image={image} /></div>}
        <DialogFooter className="photo-lightbox-actions">
          {cropping ? <><Button type="button" variant="ghost" onClick={() => setCrop(wholeImage)}><RotateCcw /> 원본 범위</Button><Button type="button" variant="outline" onClick={() => setCropping(false)}>취소</Button><Button type="button" onClick={applyCrop}>적용</Button></>
            : <>{photo.onChange && <Button type="button" variant="outline" onClick={() => { setCrop(image.crop ?? { x: .05, y: .05, width: .9, height: .9 }); setCropping(true); }}><Crop /> 자르기</Button>}{photo.onRemove && <Button type="button" variant="ghost" size="icon" aria-label="사진 삭제" onClick={() => setRemoving(true)}><Trash2 /></Button>}<Button type="button" onClick={onClose}>닫기</Button></>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={removing} onOpenChange={setRemoving}>
      <AlertDialogContent className="image-confirm-dialog"><button type="button" hidden tabIndex={-1} data-photo-back="140" onClick={() => setRemoving(false)} /><AlertDialogHeader><AlertDialogTitle>카드에서 사진을 뺄까요?</AlertDialogTitle><AlertDialogDescription>글과 다른 사진은 그대로 유지돼요.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { photo.onRemove?.(); onClose(); }}>사진 빼기</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </>;
}

function usePhotoUpload({ onUploaded, onBusyChange, disabled }: { onUploaded: (image: CardImage) => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const latest = useRef({ onUploaded, onBusyChange, disabled });
  useLayoutEffect(() => { latest.current = { onUploaded, onBusyChange, disabled }; }, [onUploaded, onBusyChange, disabled]);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { if (pending.current) { pending.current.abort(); pending.current = null; latest.current.onBusyChange?.(false); } }, []);
  async function upload(files: File[]) {
    if (pending.current || !files.length) return false;
    if (latest.current.disabled) { toast.info("저장을 마친 뒤 사진을 첨부해 주세요."); return false; }
    if (files.some((file) => !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type))) { toast.error("PNG, JPG, WEBP, GIF 사진을 선택해 주세요."); return false; }
    if (files.some((file) => file.size > MAX_IMAGE_BYTES)) { toast.error("사진은 한 장당 8MB까지 첨부할 수 있어요."); return false; }
    const controller = new AbortController(); pending.current = controller; setBusy(true); latest.current.onBusyChange?.(true);
    try {
      for (const file of files) {
        const response = await fetch("/api/images", { method: "POST", body: file, signal: controller.signal, headers: { "Content-Type": file.type } });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "사진을 첨부하지 못했어요.");
        if (controller.signal.aborted) return false;
        latest.current.onUploaded(result.image);
      }
      return true;
    } catch (error) { if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : "사진을 첨부하지 못했어요. 다시 시도해 주세요."); return false; }
    finally { if (pending.current === controller) { pending.current = null; setBusy(false); latest.current.onBusyChange?.(false); } }
  }
  return { busy, upload, cancel: () => pending.current?.abort() };
}

const fieldNames = { question: "질문", answer: "답", memo: "메모" };
const imageMoveType = "application/x-study-card-image";
type ImageMove = { field: MediaField; imageId: string };
type ImageMoveContextValue = {
  scope: string; active: ImageMove | null; disabled: boolean;
  begin: (move: ImageMove, focus: TextFocus | null) => void;
  finish: () => void; drop: (scope: string, to: MediaField) => void; suppressClick: () => boolean;
};
const ImageMoveContext = createContext<ImageMoveContextValue | null>(null);

// A scope contains only one card, even when many cards share the bulk table.
export function ImageMoveProvider({ media, onMove, disabled = false, children }: {
  media: CardMedia; onMove: (from: MediaField, to: MediaField, imageId: string) => void; disabled?: boolean; children: ReactNode;
}) {
  const scope = useId();
  const [active, setActive] = useState<ImageMove | null>(null);
  const drag = useRef<ImageMove | null>(null);
  const focus = useRef<TextFocus | null>(null);
  const clickBlockedUntil = useRef(0);
  const latest = useRef({ media, onMove, disabled });
  useLayoutEffect(() => { latest.current = { media, onMove, disabled }; }, [media, onMove, disabled]);
  const finish = useCallback(() => {
    if (!drag.current) return;
    drag.current = null; setActive(null); clickBlockedUntil.current = performance.now() + 250;
    restoreTextFocus(focus.current);
  }, []);
  useEffect(() => {
    if (!active) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Let the browser cancel its native drag, but never close the editor.
      event.stopImmediatePropagation(); finish();
    };
    window.addEventListener("keydown", escape, true);
    window.addEventListener("dragend", finish, true);
    window.addEventListener("drop", finish);
    window.addEventListener("blur", finish);
    return () => {
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("dragend", finish, true);
      window.removeEventListener("drop", finish);
      window.removeEventListener("blur", finish);
    };
  }, [active, finish]);
  return <ImageMoveContext.Provider value={{ scope, active, disabled,
    begin: (move, savedFocus) => { if (latest.current.disabled) return; focus.current = savedFocus; drag.current = move; setActive(move); },
    finish,
    suppressClick: () => !!drag.current || performance.now() < clickBlockedUntil.current,
    drop: (sourceScope, to) => {
      const source = drag.current, current = latest.current;
      if (sourceScope !== scope || !source) return;
      if (!current.disabled && source.field !== to) {
        if (current.media[to].some((item) => item.id === source.imageId)) toast.info("이 칸에 이미 같은 사진이 있어요.");
        else if (current.media[to].length >= MAX_FIELD_IMAGES) toast.info(`${fieldNames[to]}에는 사진을 ${MAX_FIELD_IMAGES}장까지 첨부할 수 있어요.`);
        else current.onMove(source.field, to, source.imageId);
      }
      finish();
    },
  }}>{children}</ImageMoveContext.Provider>;
}

export function PhotoAttachButton({ media, onChange, onBusyChange, disabled = false }: { media: CardMedia; onChange: (field: MediaField, images: CardImage[]) => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const focus = useRef<TextFocus | null>(null);
  const target = useRef<MediaField>("question");
  const latest = useRef({ media, onChange });
  useLayoutEffect(() => { latest.current = { media, onChange }; }, [media, onChange]);
  const [files, setFiles] = useState<File[]>([]);
  const { busy, upload, cancel } = usePhotoUpload({ disabled, onBusyChange, onUploaded: (image) => {
    const field = target.current, next = [...latest.current.media[field], image];
    latest.current.media = { ...latest.current.media, [field]: next }; latest.current.onChange(field, next);
    setFiles((remaining) => remaining.slice(1));
  } });
  async function choose(field: MediaField) {
    if (files.length + latest.current.media[field].length > MAX_FIELD_IMAGES) { toast.error(`${fieldNames[field]}에는 사진을 ${MAX_FIELD_IMAGES}장까지 첨부할 수 있어요.`); return; }
    target.current = field;
    if (await upload(files)) setFiles([]);
  }
  return <>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(event) => { setFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    <Button type="button" className="photo-attach-trigger" tabIndex={-1} size="icon-sm" variant="ghost" disabled={disabled || busy} aria-label="사진 첨부" title="사진 첨부"
      onMouseDown={(event) => { event.preventDefault(); focus.current = captureTextFocus(event.currentTarget.closest<HTMLElement>(".mobile-card-compose-card, .card-editor-dialog")); }}
      onClick={() => input.current?.click()}><ImagePlus /></Button>
    <Dialog open={!!files.length} onOpenChange={(open) => { if (!open && !busy) setFiles([]); }}>
      <DialogContent className="photo-destination-dialog" overlayClassName="photo-lightbox-overlay" onCloseAutoFocus={(event) => { if (focus.current) { event.preventDefault(); restoreTextFocus(focus.current); } }}>
        <button type="button" hidden tabIndex={-1} data-photo-back="121" onClick={() => { cancel(); setFiles([]); }} />
        <DialogHeader className="text-left"><DialogTitle>사진을 어디에 넣을까요?</DialogTitle><DialogDescription>{files.length}장 · 선택한 글 아래에 들어가요.</DialogDescription></DialogHeader>
        <div className="photo-destination-choices">{MEDIA_FIELDS.map((field) => <Button key={field} type="button" variant="outline" disabled={busy} onClick={() => void choose(field)}>{fieldNames[field]}</Button>)}</div>
        {busy && <p role="status"><LoaderCircle className="animate-spin" /> 첨부 중…</p>}
        <DialogFooter><Button type="button" variant="ghost" onClick={() => { cancel(); setFiles([]); }}>취소</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

export function ImageField({ images = [], onChange, label, children, compact = false, onBusyChange, disabled = false, mediaField }: {
  images?: CardImage[]; onChange: (images: CardImage[]) => void; label: string; children: ReactNode; compact?: boolean; onBusyChange?: (busy: boolean) => void; disabled?: boolean; mediaField?: MediaField;
}) {
  const [dragging, setDragging] = useState<"file" | ImageMove | null>(null);
  const field = useRef<HTMLDivElement>(null);
  const focus = useRef<TextFocus | null>(null);
  const latest = useRef({ images, onChange });
  useLayoutEffect(() => { latest.current = { images, onChange }; }, [images, onChange]);
  const openPhoto = useContext(PhotoContext);
  const move = useContext(ImageMoveContext);
  function change(next: CardImage[]) { latest.current.images = next; latest.current.onChange(next); }
  const { busy, upload, cancel } = usePhotoUpload({ disabled, onBusyChange, onUploaded: (image) => change([...latest.current.images, image]) });
  const canDrag = !!move && !!mediaField && !move.disabled && !disabled && !busy;
  const isDraggingOver = dragging === "file" || Boolean(dragging && dragging === move?.active);
  function attach(files: File[]) {
    if (files.length + latest.current.images.length > MAX_FIELD_IMAGES) { toast.error(`${label}에는 사진을 ${MAX_FIELD_IMAGES}장까지 첨부할 수 있어요.`); return; }
    void upload(files);
  }
  return <div ref={field} className={`image-field${compact ? " is-compact" : ""}${isDraggingOver ? " is-file-over" : ""}`} aria-busy={busy} data-media-field={mediaField}
    onDragOverCapture={(event) => {
      const types = Array.from(event.dataTransfer.types);
      if (types.includes(imageMoveType)) {
        event.preventDefault(); event.stopPropagation();
        const accepted = canDrag && !!move?.active && move.active.field !== mediaField;
        event.dataTransfer.dropEffect = accepted ? "move" : "none"; setDragging(accepted ? move.active : null); return;
      }
      if (!types.includes("Files")) return;
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "copy"; setDragging("file");
    }}
    onDragLeaveCapture={(event) => { if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return; setDragging(null); }}
    onDropCapture={(event) => {
      const types = Array.from(event.dataTransfer.types);
      if (types.includes(imageMoveType)) {
        event.preventDefault(); event.stopPropagation(); setDragging(null);
        if (canDrag && mediaField) move?.drop(event.dataTransfer.getData(imageMoveType), mediaField);
        else move?.finish();
        return;
      }
      if (!types.includes("Files")) return;
      event.preventDefault(); event.stopPropagation(); setDragging(null); attach(Array.from(event.dataTransfer.files));
    }}
    onPasteCapture={(event) => {
      const files = Array.from(event.clipboardData.items).filter((item) => item.kind === "file" && item.type.startsWith("image/")).map((item) => item.getAsFile()).filter((file): file is File => !!file);
      if (!files.length) return; event.preventDefault(); event.stopPropagation(); attach(files);
    }}>
    {children}
    {images.map((image) => <div className={`image-edit-frame${move?.active?.imageId === image.id && move.active.field === mediaField ? " is-moving" : ""}`} key={image.id}>
      <button type="button" data-card-photo tabIndex={-1} draggable={canDrag} className="image-open-button" disabled={disabled} aria-label={`${label} 사진 확대`} title={canDrag ? "클릭하여 확대 · 드래그하여 질문/답/메모로 이동" : "사진 확대 · 자르기"}
        onMouseDown={(event) => { focus.current = captureTextFocus(field.current); if (!canDrag) event.preventDefault(); }}
        onDragStart={(event) => {
          if (!canDrag || !mediaField || !move) { event.preventDefault(); return; }
          event.stopPropagation(); event.dataTransfer.clearData(); event.dataTransfer.setData(imageMoveType, move.scope); event.dataTransfer.effectAllowed = "move";
          move.begin({ field: mediaField, imageId: image.id }, focus.current);
        }}
        onDragEnd={(event) => { event.stopPropagation(); move?.finish(); }}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (move?.suppressClick()) return; openPhoto({ image, focus: focus.current, onChange: (next) => change(latest.current.images.map((item) => item.id === next.id ? next : item)), onRemove: () => change(latest.current.images.filter((item) => item.id !== image.id)) }); }}>
        <AttachmentImage image={image} label={`${label} 첨부 사진`} />
      </button>
      {image.alt && <span className="card-image-caption">{image.alt}</span>}
    </div>)}
    {busy && <div className="image-upload-status" role="status"><LoaderCircle className="animate-spin" /><span>첨부 중…</span><Button type="button" tabIndex={-1} variant="ghost" size="sm" onMouseDown={(event) => event.preventDefault()} onClick={cancel}>취소</Button></div>}
    {isDraggingOver && <div className="image-drop-target"><ImagePlus /> {dragging !== "file" && mediaField ? `${fieldNames[mediaField]} 글 아래로 이동` : `${label}에 사진 놓기`}</div>}
  </div>;
}
