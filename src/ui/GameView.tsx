// GameView is now a thin alias over the HUD AppShell (S3). The shell owns the
// sidebar nav, top status cards, and view routing; this keeps App.tsx's entry
// point stable while the real layout lives in AppShell.tsx.
import { AppShell } from './AppShell';

export function GameView() {
  return <AppShell />;
}
