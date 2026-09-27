"use client";

// liquid-gooey 공용 조각 3종. /liquid-lab 에서 계정 주인이 채택한 물성을 그대로 굳혔다.
// ⚠ Liquid 그룹·아이템의 위치는 className 이 아니라 style 로 넘긴다
//    (라이브러리가 인라인 스타일로 position 을 박아 클래스를 덮는다).
// - LiquidPill: 탭·세그먼트 활성 알약(Move). 컨테이너(relative) 안에 두고,
//   각 버튼에 data-pill="키" 를 단다. ActivePill 의 액체판.
// - LiquidDial: + 버튼이 물방울처럼 갈라지는 스피드 다이얼(Morph).
// - LiquidAvatars: 아바타 무리가 흰 막으로 녹아 붙는 클러스터(Morph).

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useReducedMotion } from "motion/react";
import { Liquid } from "liquid-gooey";
import { PlusIcon } from "@heroicons/react/16/solid";
import type { ComponentType, SVGProps } from "react";

// /liquid-lab 슬라이더로 고른 확정 물성
const PILL_MOVE = { springiness: 0.65, wobble: 0.4, trail: 0.6 };

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 탭·세그먼트의 활성 알약(액체판). position:relative 컨테이너의 첫 자식으로 두고,
 * 형제 버튼들에 data-pill="키" 를 단다. activeKey 가 바뀌면 알약이 액체 꼬리를
 * 끌며 그 버튼 자리로 이동한다. 라벨은 버튼 안에서 relative(z 위)로 유지.
 */
export function LiquidPill({
  activeKey,
  fill,
  shadow,
  className = "",
}: {
  activeKey: string;
  /** 알약 색. className 의 배경색과 같은 값이어야 꼬리가 몸통과 한 색이 된다. */
  fill: string;
  shadow?: string;
  /** 기존 알약 클래스 그대로 (bg 포함). 본체는 이 클래스로, 꼬리는 fill 로 그린다. */
  className?: string;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const reduce = useReducedMotion();

  useLayoutEffect(() => {
    const parent = hostRef.current?.parentElement;
    if (!parent) return;
    const measure = () => {
      const btn = Array.from(
        parent.querySelectorAll<HTMLElement>("[data-pill]"),
      ).find((el) => el.dataset.pill === activeKey);
      if (!btn) {
        setBox(null);
        return;
      }
      // offsetLeft/Top: 컨테이너(positioned) 기준 고정 좌표.
      // 가로 스크롤 탭 줄에서도 스크롤과 무관하게 맞는다(rect 차이는 어긋남).
      setBox({
        x: btn.offsetLeft,
        y: btn.offsetTop,
        w: btn.offsetWidth,
        h: btn.offsetHeight,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [activeKey]);

  const thumbStyle = box
    ? {
        position: "absolute" as const,
        left: 0,
        top: 0,
        width: box.w,
        height: box.h,
        transform: `translate(${box.x}px, ${box.y}px)`,
        transition: reduce
          ? undefined
          : "transform 260ms cubic-bezier(0.32,0.72,0.35,1), width 260ms cubic-bezier(0.32,0.72,0.35,1)",
      }
    : undefined;

  return (
    <span
      ref={hostRef}
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        display: "block",
      }}
    >
      {box &&
        (reduce ? (
          <span className={className} style={thumbStyle} />
        ) : (
          <Liquid
            blur={6}
            contrast={18}
            fill={fill}
            shadow={shadow}
            style={{ position: "absolute", inset: 0 }}
          >
            <Liquid.Item effect="move" move={PILL_MOVE}>
              <span className={className} style={thumbStyle} />
            </Liquid.Item>
          </Liquid>
        ))}
    </span>
  );
}

export interface DialAction {
  href: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

/**
 * 만들기 스피드 다이얼. + 버튼이 emerald 물방울로 갈라지며 액션 링크가 나온다.
 * fixed 우하단. 모달(z-50)보다 아래(z-40).
 */
export function LiquidDial({ actions }: { actions: DialAction[] }) {
  const [open, setOpen] = useState(false);
  const step = 60;

  return (
    <div className="fixed bottom-6 right-6 z-40 max-md:hidden">
      {/* 라벨 칩 */}
      {open &&
        actions.map((a, i) => (
          <span
            key={a.href}
            className="absolute right-16 rounded-md bg-neutral-900/80 px-2 py-1 text-[11px] whitespace-nowrap text-white"
            style={{ bottom: (i + 1) * step + 10 }}
          >
            {a.label}
          </span>
        ))}
      <Liquid
        blur={9}
        contrast={18}
        fill="#047857"
        shadow="0 4px 12px rgba(4,120,87,.35)"
        filterPadding={40}
        style={{
          position: "relative",
          width: 52,
          height: actions.length * step + 60,
        }}
      >
        {actions.map((a, i) => (
          <Liquid.Item
            key={a.href}
            x={0}
            y={open ? -(i + 1) * step - 6 : 0}
            transition="bouncy"
            delay={i * 45}
            style={{ position: "absolute", bottom: 0, right: 1 }}
          >
            <Link
              href={a.href}
              aria-label={a.label}
              tabIndex={open ? 0 : -1}
              onClick={() => setOpen(false)}
              className={`flex size-11 items-center justify-center rounded-full text-white transition-opacity duration-200 ${
                open ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              <a.Icon className="size-4" />
            </Link>
          </Liquid.Item>
        ))}
        <Liquid.Item x={0} y={0} style={{ position: "absolute", bottom: 0, right: 0 }}>
          <button
            type="button"
            aria-label="만들기"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex size-13 items-center justify-center rounded-full text-white"
          >
            <PlusIcon
              className={`size-5 transition-transform duration-300 ${open ? "rotate-45" : ""}`}
            />
          </button>
        </Liquid.Item>
      </Liquid>
    </div>
  );
}

export interface LiquidAvatarPerson {
  src?: string;
  name: string;
}

/**
 * 아바타 무리. 프로필들이 흰 액체 막으로 서로 녹아 붙는다. 최대 5개.
 */
export function LiquidAvatars({
  people,
  size = 28,
  overlap = 8,
}: {
  people: LiquidAvatarPerson[];
  size?: number;
  overlap?: number;
}) {
  const shown = people.slice(0, 5);
  if (shown.length === 0) return null;
  const step = size - overlap + 4;
  const coat = 2; // 아바타 주위 흰 막 두께(px)

  return (
    <Liquid
      blur={8}
      contrast={18}
      fill="#fff"
      shadow="0 2px 8px rgba(10,10,10,.12)"
      filterPadding={24}
      style={{
        position: "relative",
        display: "inline-block",
        width: (shown.length - 1) * step + size + coat * 2,
        height: size + coat * 2,
      }}
    >
      {shown.map((p, i) => (
        <Liquid.Item
          key={`${p.name}-${i}`}
          x={i * step}
          y={0}
          transition="bouncy"
          delay={i * 30}
          style={{ position: "absolute", left: 0, top: 0 }}
        >
          {p.src ? (
            // eslint-disable-next-line @next/next/no-img-element -- 외부 프로필 이미지
            <img
              src={p.src}
              alt={p.name}
              width={size}
              height={size}
              className="rounded-full object-cover"
              style={{ margin: coat, width: size, height: size }}
            />
          ) : (
            <span
              className="flex items-center justify-center rounded-full bg-neutral-700 font-semibold text-white"
              style={{ margin: coat, width: size, height: size, fontSize: size * 0.38 }}
            >
              {p.name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </Liquid.Item>
      ))}
    </Liquid>
  );
}
