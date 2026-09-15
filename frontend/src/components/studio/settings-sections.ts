import { CreditCard, Settings, UserRound, Wallet } from "lucide-react";

export type SettingsSection = "profile" | "payments" | "payouts" | "account";

export type SettingsGroup = "Creator" | "Money" | "Account";

export const SETTINGS_GROUPS: SettingsGroup[] = ["Creator", "Money", "Account"];

export const SETTINGS_SECTIONS: {
  id: SettingsSection;
  label: string;
  description: string;
  group: SettingsGroup;
  Icon: typeof UserRound;
}[] = [
  {
    id: "profile",
    label: "Profile",
    description: "Public name, biography, imagery, and discovery settings",
    group: "Creator",
    Icon: UserRound,
  },
  {
    id: "payments",
    label: "Payments",
    description: "Saved payment methods and paid-call activity",
    group: "Money",
    Icon: CreditCard,
  },
  {
    id: "payouts",
    label: "Creator payouts",
    description: "Balance, payout account, and monthly deposits",
    group: "Money",
    Icon: Wallet,
  },
  {
    id: "account",
    label: "Account & appearance",
    description: "Sign-in details, channel address, and display theme",
    group: "Account",
    Icon: Settings,
  },
];

export function settingsSectionsIn(group: SettingsGroup) {
  return SETTINGS_SECTIONS.filter((section) => section.group === group);
}
