import { memo, useEffect, useState, type MouseEvent } from "react";
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  onWindowResized,
  startWindowDragging,
  toggleMaximizeWindow,
} from "../lib/windowControls";

function WindowTitleBar() {
  const [isMaximizedState, setIsMaximizedState] = useState(false);

  useEffect(() => {
    let active = true;
    let detach: (() => void) | null = null;

    const syncWindowState = async () => {
      const nextState = await isWindowMaximized();
      if (active) {
        setIsMaximizedState(nextState);
      }
    };

    void syncWindowState();
    void onWindowResized(() => {
      void syncWindowState();
    }).then((unlisten) => {
      detach = unlisten;
    });

    return () => {
      active = false;
      detach?.();
    };
  }, []);

  function isInteractiveTarget(target: EventTarget | null) {
    return target instanceof HTMLElement && Boolean(target.closest("[data-titlebar-interactive='true']"));
  }

  function handlePointerDown(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || isInteractiveTarget(event.target)) {
      return;
    }
    void startWindowDragging();
  }

  function handleDoubleClick(event: MouseEvent<HTMLDivElement>) {
    if (isInteractiveTarget(event.target)) {
      return;
    }
    void toggleMaximizeWindow();
  }

  return (
    <header
      className="window-titlebar"
      data-testid="window-titlebar"
      onDoubleClick={handleDoubleClick}
      onMouseDown={handlePointerDown}
    >
      <div className="window-titlebar-controls" data-titlebar-interactive="true">
        <button
          aria-label="Minimize window"
          className="window-titlebar-control"
          data-testid="window-minimize"
          onClick={() => void minimizeWindow()}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16">
            <path d="M3 8h10" />
          </svg>
        </button>
        <button
          aria-label={isMaximizedState ? "Restore window" : "Maximize window"}
          className="window-titlebar-control"
          data-testid="window-maximize"
          onClick={() => void toggleMaximizeWindow()}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16">
            {isMaximizedState ? (
              <>
                <path d="M5 3h8v8" />
                <path d="M3 5h8v8H3z" />
              </>
            ) : (
              <path d="M3 3h10v10H3z" />
            )}
          </svg>
        </button>
        <button
          aria-label="Close window"
          className="window-titlebar-control danger"
          data-testid="window-close"
          onClick={() => void closeWindow()}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16">
            <path d="M4 4l8 8" />
            <path d="M12 4l-8 8" />
          </svg>
        </button>
      </div>

      <div className="window-titlebar-label">Clawnetes</div>

      <div aria-hidden="true" className="window-titlebar-spacer" />
    </header>
  );
}

export default memo(WindowTitleBar);
