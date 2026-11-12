import { REFERRAL } from "../referral";
import { t } from "../i18n";

/** 「还没有账号？注册」+ 推广链接说明。该平台没有推广链接时什么都不显示。 */
export default function ReferralLink({ vendor, name }: { vendor: string; name: string }) {
  const url = REFERRAL[vendor];
  if (!url) return null;
  return (
    <span className="referral small">
      {t("还没有账号？", "No account yet? ")}
      <a href={url} target="_blank" rel="noreferrer">{t("注册{name}", "Sign up for {name}", { name })}</a>
      <span className="muted" title={t("通过这个链接注册，作者能获得平台给的少量奖励（返佣或代金券），你的价格不变。不想用可以直接去官网注册。",
        "If you sign up through this link, the author gets a small reward from the platform (commission or credits). Your price is unchanged. You can also sign up on the official site directly.")}>
        {t("（推广链接，作者可获少量奖励，你的价格不变）", " (referral link: the author gets a small reward, your price is unchanged)")}
      </span>
    </span>
  );
}
