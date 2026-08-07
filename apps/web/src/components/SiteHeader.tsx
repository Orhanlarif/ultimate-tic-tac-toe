"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  IconBot,
  IconChevronDown,
  IconClose,
  IconDevice,
  IconDoor,
  IconLeaderboard,
  IconLogin,
  IconLogout,
  IconMenu,
  IconShield,
  IconTrophy,
  IconUser,
  IconUsers,
  IconZap,
} from "@/components/icons";
import { ChallengeMenuItems } from "@/components/ChallengeMenuItems";
import { isMatchFocusPath } from "@/components/ChallengeToast";
import { useFriendChallengesContext } from "@/components/FriendChallengesProvider";
import { PlayerAvatar } from "@/components/Marks";

export function SiteHeader() {
  const t = useTranslations("app");
  const h = useTranslations("home");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const { incoming } = useFriendChallengesContext();
  const challengeCount = incoming.length;
  const matchFocus = isMatchFocusPath(pathname);
  const [scrolled, setScrolled] = useState(false);
  const [playOpen, setPlayOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const playRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setPlayOpen(false);
    setAccountOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!playOpen && !accountOpen) return;
    function onPointer(e: MouseEvent) {
      if (!playRef.current?.contains(e.target as Node)) setPlayOpen(false);
      if (!accountRef.current?.contains(e.target as Node)) setAccountOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setPlayOpen(false);
      setAccountOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [playOpen, accountOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  async function switchLocale() {
    const next = locale === "tr" ? "en" : "tr";
    await fetch("/api/locale", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: next }),
    });
    router.refresh();
  }

  const signedIn = status === "authenticated" && Boolean(session?.user);
  const isAdmin = Boolean(session?.user?.isAdmin);
  const rankedHref = signedIn ? "/play?mode=ranked" : "/login?next=/play?mode=ranked";
  const displayName = session?.user?.name ?? t("profile");
  const username = session?.user?.username;
  const profileHref = username ? `/u/${username}` : null;

  const playItems = [
    {
      href: "/play?mode=casual",
      title: t("playCasual"),
      desc: h("modeCasualDesc"),
      icon: <IconZap />,
      iconClass: "icon-casual",
    },
    {
      href: rankedHref,
      title: t("playRanked"),
      desc: h("modeRankedDesc"),
      icon: <IconTrophy />,
      iconClass: "icon-ranked",
    },
    {
      href: "/play/bot",
      title: t("playBot"),
      desc: h("modeBotDesc"),
      icon: <IconBot />,
      iconClass: "icon-bot",
    },
    {
      href: "/play/local",
      title: t("playLocal"),
      desc: h("modeLocalDesc"),
      icon: <IconDevice />,
      iconClass: "icon-local",
    },
    {
      href: "/play/room",
      title: t("playRoom"),
      desc: h("modeRoomDesc"),
      icon: <IconDoor />,
      iconClass: "icon-room",
    },
  ];

  return (
    <>
      <header className={`site-header ${scrolled ? "is-scrolled" : ""}`}>
        <div className="container site-header-inner">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              {Array.from({ length: 9 }, (_, index) => (
                <span key={index} />
              ))}
            </span>
            <span className="brand-copy">
              <strong>{t("name")}</strong>
              <span className="muted">{t("tagline")}</span>
            </span>
          </Link>

          <nav className="site-nav desktop-only" aria-label="Main navigation">
            <div
              className={`nav-play ${playOpen ? "is-open" : ""}`}
              ref={playRef}
            >
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                aria-expanded={playOpen}
                aria-haspopup="menu"
                onClick={() => setPlayOpen((v) => !v)}
              >
                {t("playMenu")}
                <IconChevronDown />
              </button>
              <div className="nav-play-menu" role="menu">
                {playItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="nav-play-item"
                    role="menuitem"
                    onClick={() => setPlayOpen(false)}
                  >
                    <span className={`nav-play-icon ${item.iconClass}`}>
                      {item.icon}
                    </span>
                    <span className="nav-play-copy">
                      <strong>{item.title}</strong>
                      <span>{item.desc}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            <Link
              className={`nav-link ${pathname.startsWith("/leaderboard") ? "is-active" : ""}`}
              href="/leaderboard"
            >
              <IconLeaderboard />
              {t("leaderboard")}
            </Link>
            <Link
              className={`nav-link ${pathname.startsWith("/friends") ? "is-active" : ""}`}
              href="/friends"
            >
              <IconUsers />
              {t("friends")}
              {challengeCount > 0 && !matchFocus ? (
                <span className="nav-badge" aria-label={String(challengeCount)}>
                  {challengeCount}
                </span>
              ) : null}
            </Link>
          </nav>

          <div className="header-actions">
            <button
              className="locale-btn desktop-only"
              type="button"
              onClick={() => void switchLocale()}
              aria-label={t("language")}
              title={t("language")}
            >
              {locale.toUpperCase()}
            </button>

            <div className="desktop-only nav-cluster">
              {signedIn ? (
                <div
                  className={`nav-account ${accountOpen ? "is-open" : ""}`}
                  ref={accountRef}
                >
                  <button
                    className="account-trigger"
                    type="button"
                    aria-expanded={accountOpen}
                    aria-haspopup="menu"
                    onClick={() => setAccountOpen((v) => !v)}
                  >
                    <span className="account-trigger-avatar">
                      <PlayerAvatar name={displayName} />
                      {challengeCount > 0 ? (
                        <span className="account-notify-dot" aria-hidden="true" />
                      ) : null}
                    </span>
                    <span className="account-trigger-name">{displayName}</span>
                    <IconChevronDown />
                  </button>
                  <div className="account-menu" role="menu">
                    <div className="account-menu-head">
                      <PlayerAvatar name={displayName} size="lg" />
                      <span className="account-menu-id">
                        <strong>{displayName}</strong>
                        {username ? <span className="muted">@{username}</span> : null}
                      </span>
                    </div>
                    <ChallengeMenuItems onDone={() => setAccountOpen(false)} />
                    {profileHref ? (
                      <Link
                        className="account-menu-item"
                        href={profileHref}
                        role="menuitem"
                        onClick={() => setAccountOpen(false)}
                      >
                        <IconUser />
                        {t("profile")}
                      </Link>
                    ) : null}
                    {isAdmin ? (
                      <Link
                        className="account-menu-item"
                        href="/admin"
                        role="menuitem"
                        onClick={() => setAccountOpen(false)}
                      >
                        <IconShield />
                        {t("admin")}
                      </Link>
                    ) : null}
                    <button
                      className="account-menu-item is-danger"
                      type="button"
                      role="menuitem"
                      onClick={() => void signOut({ callbackUrl: "/" })}
                    >
                      <IconLogout />
                      {t("signOut")}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <Link className="btn btn-ghost btn-sm" href="/login">
                    <IconLogin />
                    {t("signIn")}
                  </Link>
                  <Link className="btn btn-primary btn-sm" href="/register">
                    {t("signUp")}
                  </Link>
                </>
              )}
            </div>

            {/* One trigger only: the avatar and the hamburger opened the same
                sheet and just crowded the phone header. */}
            {signedIn ? (
              <button
                className="header-avatar mobile-only"
                type="button"
                aria-label={t("openMenu")}
                aria-expanded={mobileOpen}
                onClick={() => setMobileOpen(true)}
              >
                <PlayerAvatar name={displayName} />
                {challengeCount > 0 ? <span className="header-avatar-dot" aria-hidden="true" /> : null}
              </button>
            ) : (
              <button
                className="menu-toggle mobile-only"
                type="button"
                aria-label={t("openMenu")}
                aria-expanded={mobileOpen}
                onClick={() => setMobileOpen(true)}
              >
                <IconMenu />
              </button>
            )}
          </div>
        </div>
      </header>

      <div
        className={`mobile-sheet mobile-only ${mobileOpen ? "is-open" : ""}`}
        aria-hidden={!mobileOpen}
      >
        <button
          className="mobile-sheet-backdrop"
          type="button"
          aria-label={t("closeMenu")}
          onClick={() => setMobileOpen(false)}
        />
        <div className="mobile-sheet-panel" role="dialog" aria-modal="true">
          <div className="mobile-sheet-head">
            <strong>{t("name")}</strong>
            <button
              className="locale-btn"
              type="button"
              aria-label={t("closeMenu")}
              onClick={() => setMobileOpen(false)}
            >
              <IconClose />
            </button>
          </div>

          {signedIn ? (
            <div className="sheet-account">
              <PlayerAvatar name={displayName} size="lg" />
              <span className="sheet-account-id">
                <strong>{displayName}</strong>
                {username ? <span className="muted">@{username}</span> : null}
              </span>
              {profileHref ? (
                <Link
                  className="btn btn-ghost btn-sm"
                  href={profileHref}
                  onClick={() => setMobileOpen(false)}
                >
                  {t("profile")}
                </Link>
              ) : null}
              {isAdmin ? (
                <Link
                  className="btn btn-ghost btn-sm"
                  href="/admin"
                  onClick={() => setMobileOpen(false)}
                >
                  {t("admin")}
                </Link>
              ) : null}
            </div>
          ) : null}

          <nav className="mobile-sheet-nav" aria-label="Mobile navigation">
            {playItems.map((item) => (
              <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)}>
                <span className={`nav-play-icon ${item.iconClass}`}>{item.icon}</span>
                {item.title}
              </Link>
            ))}
            <Link href="/leaderboard" onClick={() => setMobileOpen(false)}>
              <span className="nav-play-icon">
                <IconLeaderboard />
              </span>
              {t("leaderboard")}
            </Link>
            <Link href="/friends" onClick={() => setMobileOpen(false)}>
              <span className="nav-play-icon">
                <IconUsers />
              </span>
              {t("friends")}
              {challengeCount > 0 && !matchFocus ? (
                <span className="nav-badge" aria-label={String(challengeCount)}>
                  {challengeCount}
                </span>
              ) : null}
            </Link>
            {isAdmin ? (
              <Link href="/admin" onClick={() => setMobileOpen(false)}>
                <span className="nav-play-icon">
                  <IconShield />
                </span>
                {t("admin")}
              </Link>
            ) : null}
          </nav>

          <div className="mobile-sheet-footer">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => void switchLocale()}
            >
              {t("language")}: {locale.toUpperCase()}
            </button>
            {signedIn ? (
              <button
                className="btn btn-danger"
                type="button"
                onClick={() => void signOut({ callbackUrl: "/" })}
              >
                <IconLogout />
                {t("signOut")}
              </button>
            ) : (
              <>
                <Link
                  className="btn btn-ghost"
                  href="/login"
                  onClick={() => setMobileOpen(false)}
                >
                  <IconLogin />
                  {t("signIn")}
                </Link>
                <Link
                  className="btn btn-primary"
                  href="/register"
                  onClick={() => setMobileOpen(false)}
                >
                  {t("signUp")}
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
