import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ImageField, ImageMoveProvider, PhotoViewerProvider } from "../../components/card-images";
import { MEDIA_FIELDS, moveCardImage, type CardMedia } from "../../lib/card-media";
import "../../app/globals.css";

const names = { question: "질문", answer: "답", memo: "메모" };
function Fixture() {
  const [media, setMedia] = useState<CardMedia>({ question: [{
    id: "00000000-0000-4000-8000-000000000001", alt: "검증 사진",
    width: 100, align: "center", position: "after", crop: { x: .1, y: .2, width: .6, height: .5 },
  }], answer: [], memo: [] });
  return <PhotoViewerProvider><ImageMoveProvider media={media}
    onMove={(from, to, id) => setMedia(current => moveCardImage(current, from, to, id))}>
    <main style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, padding: 20 }}>
      {MEDIA_FIELDS.map(field => <ImageField key={field} images={media[field]} mediaField={field} label={names[field]}
        onChange={images => setMedia(current => ({ ...current, [field]: images }))}>
        <textarea aria-label={names[field]} defaultValue={`${names[field]} 내용`} />
      </ImageField>)}
    </main>
    <output data-testid="media">{JSON.stringify(media)}</output>
  </ImageMoveProvider></PhotoViewerProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
