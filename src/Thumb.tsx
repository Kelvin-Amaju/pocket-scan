import { useEffect, useRef, useState } from "react";
import { File, Image, Music2, Video } from "lucide-react";
import type { Entry } from "./types";
import { isAndroid, Scanner } from "./scanner";
const cache = new Map<string, string>();
let active = 0;
const queue: (() => void)[] = [];
function limited<T>(run: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const task = () => {
      active++;
      run()
        .then(resolve, reject)
        .finally(() => {
          active--;
          queue.shift()?.();
        });
    };
    if (active < 3) task();
    else queue.push(task);
  });
}
export default function Thumb({ entry }: { entry: Entry }) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState("");
  useEffect(() => {
    let alive = true;
    let url = "";
    setSrc("");
    const key = entry.uri + ":" + entry.modified;
    const observer = new IntersectionObserver(
      (records) => {
        if (!records.some((r) => r.isIntersecting)) return;
        observer.disconnect();
        if (entry.category !== "photos" && entry.category !== "videos") return;
        if (entry.file && entry.category === "photos") {
          url = URL.createObjectURL(entry.file);
          setSrc(url);
        } else if (isAndroid) {
          if (cache.has(key)) setSrc(cache.get(key)!);
          else
            void limited(async () => {
              if (!alive) return "";
              return (await Scanner.thumbnail({ uri: entry.uri })).data;
            })
              .then((data) => {
                if (!data) return;
                if (cache.size >= 120) cache.delete(cache.keys().next().value!);
                cache.set(key, data);
                if (alive) setSrc(data);
              })
              .catch(() => {});
        }
      },
      { rootMargin: "120px" },
    );
    if (ref.current) observer.observe(ref.current);
    return () => {
      alive = false;
      observer.disconnect();
      if (url) URL.revokeObjectURL(url);
    };
  }, [entry.id, entry.modified, entry.file]);
  const Icon =
    entry.category === "photos"
      ? Image
      : entry.category === "videos"
        ? Video
        : entry.category === "audio"
          ? Music2
          : File;
  return (
    <div ref={ref} className={`thumb ${entry.category}`}>
      {src ? (
        <img src={src} alt="" loading="lazy" onError={() => setSrc("")} />
      ) : (
        <Icon size={25} />
      )}
    </div>
  );
}
