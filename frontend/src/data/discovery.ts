// Design-preview fixtures only. Replace with a discovery API when it is available.
// Demo profiles deliberately use /discover/:username, never a real caller queue.
export const creators = [
  {
    username: "maya",
    name: "Maya Chen",
    category: "Just chatting",
    title: "Big dreams. Honest conversations.",
    description:
      "Let's talk creative careers, taking the leap, and figuring it out along the way.",
    audience: "2.4K",
    live: true,
    color: "coral",
    image: "photo-1534528741775-53994a69daeb",
    tag: "Creative life",
  },
  {
    username: "devon",
    name: "Devon Miles",
    category: "Music",
    title: "Your next favorite record is in here",
    description:
      "New sounds, old favorites, and the stories behind the music. Come talk records.",
    audience: "1.8K",
    live: true,
    color: "sage",
    image: "photo-1500648767791-00dcc994a43e",
    tag: "Music & culture",
  },
  {
    username: "nora",
    name: "Nora James",
    category: "Just chatting",
    title: "A little life advice. A lot of real talk.",
    description:
      "An open line for everything on your mind. Grab a coffee and settle in.",
    audience: "942",
    live: true,
    color: "lavender",
    image: "photo-1524504388940-b1c1722653e1",
    tag: "Life advice",
  },
  {
    username: "alex",
    name: "Alex Rivera",
    category: "Gaming",
    title: "Between games, let's catch up",
    description:
      "Talking games, good plays, and whatever else comes up with the community.",
    audience: "786",
    live: true,
    color: "sand",
    image: "photo-1506794778202-cad84cf45f1d",
    tag: "Gaming",
  },
  {
    username: "imani",
    name: "Imani Brooks",
    category: "Creative",
    title: "Make something that feels like you",
    description:
      "A space to share your work, talk ideas, and find your creative voice.",
    audience: "",
    live: false,
    color: "sage",
    image: "photo-1531123897727-8f129e1688ce",
    tag: "Art & design",
  },
  {
    username: "leo",
    name: "Leo Park",
    category: "Tech",
    title: "Building things, together",
    description:
      "From side projects to big ideas. Let's talk about what you're making.",
    audience: "",
    live: false,
    color: "lavender",
    image: "photo-1507003211169-0a1dd7228f2d",
    tag: "Tech & ideas",
  },
] as const;
export type Creator = (typeof creators)[number];
export function portrait(creator: Creator, width = 600) {
  return `https://images.unsplash.com/${creator.image}?auto=format&fit=crop&w=${width}&q=85`;
}
