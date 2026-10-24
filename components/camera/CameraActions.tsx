import { Camera, LoaderCircle, RefreshCw } from "lucide-react";
import type { CameraOperation, CameraView } from "@/lib/camera-session";

type CameraActionsProps = {
  screen: CameraView["kind"];
  operation: CameraOperation;
  availability: "checking" | "ready" | "unavailable";
  status: string;
  error: string;
  onReconnect: () => void;
  onAnalyze: () => void;
  onCamera: () => void;
  onAlbum: () => void;
};

export function CameraActions({ screen, operation, availability, status, error, onReconnect, onAnalyze, onCamera, onAlbum }: CameraActionsProps) {
  const pending = operation !== "idle";
  const checking = availability === "checking";
  return (
    <div className="notebook-actions">
      {availability === "unavailable" ? <div role="status">
        <p className="inline-message">지금은 노트를 만들 수 없어요. 잠시 후 다시 연결해주세요.</p>
        <button className="text-button" onClick={onReconnect} disabled={pending}><RefreshCw size={18} />다시 연결</button>
      </div> : null}
      {error ? <p className="inline-message" role="alert">{error}</p> : null}
      {screen === "photo" ? <>
        <button className="button primary full-width" disabled={availability !== "ready" || pending} onClick={onAnalyze}>
          {pending || checking ? <LoaderCircle size={20} className="spinner" aria-hidden="true" /> : null}
          {pending || checking ? status : "내용 정리"}
        </button>
        <button className="text-button full-width" disabled={pending} onClick={onCamera}>다시 촬영</button>
      </> : <>
        <button className={`button full-width ${screen === "list" ? "primary" : "outline"}`} disabled={pending} onClick={onCamera}>
          {operation === "preparing" ? <LoaderCircle size={20} className="spinner" aria-hidden="true" /> : <Camera size={20} aria-hidden="true" />}
          {operation === "preparing" ? status : screen === "list" ? "사진 촬영" : "새 사진 촬영"}
        </button>
        <button className="text-button full-width" disabled={pending} onClick={onAlbum}>앨범에서 선택</button>
      </>}
    </div>
  );
}
