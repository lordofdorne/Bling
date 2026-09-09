import { createContext, useContext } from "react";

export const FollowContext = createContext<{
  following: string[];
  toggle: (id: string) => void;
}>({ following: [], toggle: () => {} });

export function usePreviewFollows() {
  return useContext(FollowContext);
}
