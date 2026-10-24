import { ArrowLeft, Search } from "lucide-react";
import type { CameraView } from "@/lib/camera-session";

type CameraHeaderProps = {
  screen: CameraView["kind"];
  pending: boolean;
  onSearch: () => void;
  onBack: () => void;
  onChoose: () => void;
};

export function CameraHeader({ screen, pending, onSearch, onBack, onChoose }: CameraHeaderProps) {
  return (
    <header className={screen === "list" ? "topbar" : "notebook-topbar"}>
      {screen === "list" ? <>
        <span className="brand">슬림보드</span>
        <button className="text-button icon-button" aria-label="기록 검색" onClick={onSearch}><Search size={22} /></button>
      </> : <>
        <button className="text-button icon-button" aria-label="기록 목록으로" disabled={pending} onClick={onBack}><ArrowLeft size={22} /></button>
        <span>{screen === "photo" ? "사진 확인" : "노트"}</span>
        {screen === "photo" ? <button className="text-button" disabled={pending} onClick={onChoose}>다시 선택</button> : <span />}
      </>}
    </header>
  );
}
