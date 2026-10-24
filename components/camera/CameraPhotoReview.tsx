import { PhotoZoom } from "@/components/PhotoZoom";
import type { Ref } from "react";

type CameraPhotoReviewProps = { preview?: string; headingRef: Ref<HTMLHeadingElement> };

export function CameraPhotoReview({ preview, headingRef }: CameraPhotoReviewProps) {
  return (
    <section className="photo-review" aria-labelledby="photo-title">
      <h1 className="sr-only" id="photo-title" tabIndex={-1} ref={headingRef}>사진 확인</h1>
      <div className="review-image">{preview ? <PhotoZoom src={preview} alt="정리할 사진" downloadUrl={preview} className="capture-photo-zoom" /> : null}</div>
      <p className="session-caption">글씨가 잘 보이는지 확인해 주세요.</p>
    </section>
  );
}
