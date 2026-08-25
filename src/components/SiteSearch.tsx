"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

import { searchFrames, type SearchDoc } from "@/lib/search";
import styles from "./SiteSearch.module.css";

/**
 * The header search affordance, opened as an overlay panel.
 *
 * The whole index arrives as a prop and is matched in the browser: the static
 * export has no server to ask, and at this scale the index is smaller than the
 * request to fetch it would be.
 */
export function SiteSearch({ docs }: { docs: SearchDoc[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const hits = useMemo(() => searchFrames(docs, query), [docs, query]);
  const showingRecent = query.trim() === "";

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
    // Send focus back where it came from, so a keyboard user is not dropped at
    // the top of the document.
    buttonRef.current?.focus();
  }, []);

  const go = useCallback(
    (slug: string) => {
      close();
      router.push(`/frame/${slug}`);
    },
    [close, router],
  );

  // Cmd/Ctrl-K from anywhere. Bound while closed too, so it is a way in.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((wasOpen) => !wasOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();

    // The panel is the scrollable surface while it is up; letting the page
    // behind it scroll drags the anchor out from under the results.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // A narrowing query can strand the cursor past the end of the list.
  useEffect(() => {
    setActive((current) => (current < hits.length ? current : 0));
  }, [hits.length]);

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (hits.length) setActive((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (hits.length) setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[active];
      if (hit) go(hit.doc.slug);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={styles.trigger}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Search frames"
      >
        <Search size={14} strokeWidth={1.5} aria-hidden="true" />
        <span className={styles.triggerLabel}>Search</span>
      </button>

      {open ? (
        <div
          className={styles.scrim}
          // A press that both starts and ends on the scrim is a dismiss; one
          // that merely ends there after a drag-select inside the panel is not.
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            className={styles.panel}
            role="dialog"
            aria-modal="true"
            aria-label="Search frames"
            onKeyDown={onKeyDown}
          >
            <div className={styles.field}>
              <Search
                size={15}
                strokeWidth={1.5}
                aria-hidden="true"
                className={styles.fieldIcon}
              />
              <input
                ref={inputRef}
                type="text"
                className={styles.input}
                placeholder="Catalog id, name, constellation…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={hits[active] ? `${listId}-${active}` : undefined}
                autoComplete="off"
                spellCheck={false}
              />
              <button type="button" className={styles.escape} onClick={close}>
                Esc
              </button>
            </div>

            {hits.length === 0 ? (
              <p className={styles.empty}>
                No frame matches <span className={styles.emptyQuery}>{query}</span>
              </p>
            ) : (
              <>
                <div className={styles.sectionLabel}>
                  {showingRecent
                    ? "Recent frames"
                    : `${hits.length} ${hits.length === 1 ? "match" : "matches"}`}
                </div>

                <ul className={styles.list} id={listId} role="listbox" ref={listRef}>
                  {hits.map(({ doc }, i) => {
                    const sky = [doc.commonName, doc.constellation].filter(Boolean).join(" · ");
                    const meta = [doc.dateLabel, doc.palette].filter(Boolean).join(" · ");
                    return (
                      <li key={doc.slug} role="none">
                        <button
                          type="button"
                          id={`${listId}-${i}`}
                          role="option"
                          aria-selected={i === active}
                          className={
                            i === active ? `${styles.row} ${styles.rowActive}` : styles.row
                          }
                          // Hover moves the cursor too, so mouse and keyboard
                          // never disagree about what Enter would open.
                          onMouseMove={() => setActive(i)}
                          onClick={() => go(doc.slug)}
                        >
                          <span className={styles.thumb} aria-hidden="true">
                            {doc.thumb ? (
                              <picture>
                                {doc.thumb.webp ? (
                                  <source srcSet={doc.thumb.webp} type="image/webp" />
                                ) : null}
                                <img
                                  src={doc.thumb.jpeg ?? doc.thumb.webp}
                                  alt=""
                                  width={doc.thumb.width}
                                  height={doc.thumb.height}
                                  loading="lazy"
                                  decoding="async"
                                />
                              </picture>
                            ) : null}
                          </span>

                          <span className={styles.rowText}>
                            <span className={styles.rowTitle}>{doc.catalogId}</span>
                            {sky ? <span className={styles.rowSky}>{sky}</span> : null}
                          </span>

                          <span className={styles.rowMeta}>{meta}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>

                <div className={styles.hints}>
                  <span>
                    <kbd className={styles.kbd}>↑</kbd>
                    <kbd className={styles.kbd}>↓</kbd>
                    navigate
                  </span>
                  <span>
                    <kbd className={styles.kbd}>↵</kbd>
                    open
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
