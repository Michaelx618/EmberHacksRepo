/** Shared tutor-action types + helpers safe for client components. */

export type YoutubeRec = {
  title: string;
  url: string;
  why: string;
};

export type ToolEvent =
  | { tool: "retrieve"; query: string; hits: { title: string; summary: string }[] }
  | { tool: "edit_graph"; title: string; wasGhost: boolean; reason: string }
  | {
      tool: "propose_link";
      sourceTitle: string;
      targetTitle: string;
      relation: string;
      rationale: string;
      sourceId: string;
      targetId: string;
    }
  | { tool: "youtube"; items: YoutubeRec[] };

export function youtubeThumb(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : null;
}
