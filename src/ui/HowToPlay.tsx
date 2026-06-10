// "How to play" — a first-time-player guide covering Archipelago itself,
// Digipelago, preparing a YAML/seed, connecting, and how play works.
// Pure presentation: no game/ap/data imports, so it can render pre-connect
// (from the connection screen) and post-connect (as a nav view) identically.

import type { ReactNode } from 'react';
import { ArrowLeft, BookOpen, Compass, FileCode, Globe, HelpCircle, Plug, Swords } from 'lucide-react';

const LINKS = {
  archipelago: 'https://archipelago.gg',
  releases: 'https://github.com/dowlle/Digipelago/releases',
  generate: 'https://archipelago.gg/generate',
};

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--dp-primary)' }}>
      {children}
    </a>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="dp-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <span style={{ color: 'var(--dp-primary)' }} aria-hidden>
          {icon}
        </span>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--dp-text)', fontFamily: 'var(--dp-font-disp)' }}>
          {title}
        </h3>
      </div>
      <div className="flex flex-col gap-2 text-sm" style={{ color: 'var(--dp-text-secondary)' }}>{children}</div>
    </section>
  );
}

/** A YAML option row: name + short meaning. */
function Opt({ name, children }: { name: string; children: ReactNode }) {
  return (
    <li>
      <code className="text-[12px]" style={{ color: 'var(--dp-text)' }}>
        {name}
      </code>{' '}
      <span>{children}</span>
    </li>
  );
}

export function HowToPlay({ onBack }: { onBack?: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {onBack && (
          <button type="button" className="dp-toggle-btn inline-flex items-center gap-1.5 text-sm" onClick={onBack}>
            <ArrowLeft size={14} aria-hidden /> Back
          </button>
        )}
        <h2 className="text-lg font-bold" style={{ color: 'var(--dp-text)', fontFamily: 'var(--dp-font-disp)' }}>
          How to play
        </h2>
      </div>

      <Section icon={<Globe size={16} />} title="What is Archipelago?">
        <p>
          <ExtLink href={LINKS.archipelago}>Archipelago</ExtLink> is a multiworld randomizer. A group of
          players each bring a game; every game's unlocks are shuffled into one shared pool. As you make
          progress in your game you find items that belong to the others, and your own unlocks arrive from
          their games. Everyone plays their own game, together.
        </p>
        <p>
          You can also play solo: a multiworld of one works fine, and it is the easiest way to try
          Digipelago.
        </p>
      </Section>

      <Section icon={<Compass size={16} />} title="What is Digipelago?">
        <p>
          Digipelago is a Digimon guessing game built as an Archipelago game. It runs entirely on this
          page: there is nothing to install to play, only to generate the multiworld.
        </p>
        <p>
          Items from the multiworld widen what you can guess: <strong>DigiStorage Upgrades</strong> raise
          how many Digimon you can have caught, progressive <strong>Digivolution</strong> keys unlock
          levels (Rookie up to Mega), and <strong>Attribute Keys</strong> unlock attributes (Vaccine,
          Virus, Data, Free, Variable, Unknown). Each correct guess catches that Digimon and completes a
          check, which sends an item to someone in the multiworld. Catch enough Digimon (your YAML's goal)
          and you win your slot.
        </p>
        <p className="text-xs" style={{ color: 'var(--dp-text-faint)' }}>
          Digipelago is an unofficial, non-commercial fan project. Digimon is the property of its
          respective owners; this site hosts no Digimon artwork.
        </p>
      </Section>

      <Section icon={<BookOpen size={16} />} title="Step 1: Install Archipelago and the Digipelago world">
        <p>
          Whoever generates the multiworld needs the <ExtLink href={LINKS.archipelago}>Archipelago</ExtLink>{' '}
          software (version 0.6.7 or newer) plus the Digipelago world file. Download{' '}
          <code className="text-[12px]" style={{ color: 'var(--dp-text)' }}>digipelago.apworld</code> from
          the <ExtLink href={LINKS.releases}>releases page</ExtLink> and double-click it to install it into
          Archipelago (or drop it in Archipelago's <code className="text-[12px]">custom_worlds</code>{' '}
          folder).
        </p>
        <p>
          If someone else is generating and hosting, you can skip straight to step 4 once they give you a
          server address and your slot name.
        </p>
      </Section>

      <Section icon={<FileCode size={16} />} title="Step 2: Make your YAML">
        <p>
          A YAML file describes your slot: your player name, the game, and your options. In the
          Archipelago Launcher, pick <em>Generate Template Options</em> to get a Digipelago template, then
          edit it in any text editor. The options that shape your game most:
        </p>
        <ul className="ml-4 flex list-disc flex-col gap-1">
          <Opt name="goal / goal_count / goal_level">
            what winning means: catch a total number of Digimon, or a number of one level (for example 20
            Ultimates).
          </Opt>
          <Opt name="starting_mode">
            the input mode you open in: <em>silhouette</em> (default, multiple choice), <em>free_text</em>{' '}
            (type names), <em>free_text_hard</em> (hidden target with clues), or <em>mixed</em> (each round
            rolls typing or multiple choice).
          </Opt>
          <Opt name="allow_mode_switch">
            off by default, which locks you to the starting mode for the whole seed. Turn it on to switch
            modes freely while playing.
          </Opt>
          <Opt name="mc_difficulty">
            how confusable the wrong silhouette options are: <em>easy</em>, <em>normal</em>, or{' '}
            <em>hard</em> (lookalike variants of the same Digimon family).
          </Opt>
          <Opt name="starting_capacity">
            how many Digimon your DigiStorage holds before the multiworld sends upgrades.
          </Opt>
        </ul>
        <p>
          Stamina and food pacing (silhouette mode) is also configurable; the defaults are sensible, so
          you can ignore those options on a first game.
        </p>
      </Section>

      <Section icon={<Swords size={16} />} title="Step 3: Generate and host the multiworld">
        <p>
          Collect every player's YAML in Archipelago's <code className="text-[12px]">Players</code> folder
          and run <em>Generate</em> from the Launcher. Then host the result: upload the generated zip at{' '}
          <ExtLink href={LINKS.archipelago}>archipelago.gg</ExtLink> under <em>Host Game</em> to get a room
          page with an address and port, or run the Archipelago server locally for an offline game.
        </p>
        <p className="text-xs" style={{ color: 'var(--dp-text-faint)' }}>
          Note: the archipelago.gg website can only generate games for worlds it ships with. Digipelago is
          a custom world, so the seed must be generated locally with the apworld installed; hosting the
          generated game on archipelago.gg works fine.
        </p>
      </Section>

      <Section icon={<Plug size={16} />} title="Step 4: Connect">
        <p>
          On the connect screen, enter the server host and port (from the room page, for example{' '}
          <code className="text-[12px]">archipelago.gg</code> and the room's port number), your slot name
          (the <code className="text-[12px]">name</code> in your YAML), and the room password if one was
          set. That's it: the game state loads from the server and you start guessing.
        </p>
        <p>
          This page is served over HTTPS, so it can reach secure (wss) servers like archipelago.gg
          directly; a plain unencrypted server only works at localhost.
        </p>
        <p>
          Logging in with Discord is optional. It syncs your unlocked palettes and lets you save
          connections across devices; logged out, everything stays on this device.
        </p>
      </Section>

      <Section icon={<HelpCircle size={16} />} title="Playing: modes, Stamina, and the Digidex">
        <ul className="ml-4 flex list-disc flex-col gap-1">
          <li>
            <strong>Silhouette</strong> (default): name the silhouette from four options. A wrong pick
            spends <strong>Stamina</strong>; Stamina regenerates one point at a time, and food items from
            the multiworld (Processed Meat, Digimeat, DigiProtein) refill it instantly. You can never get
            permanently stuck.
          </li>
          <li>
            <strong>Free-text</strong>: type the name of any Digimon you can currently catch.
          </li>
          <li>
            <strong>Hard free-text</strong>: a hidden target plus per-guess clues (level, attribute, and
            more) that steer you toward it.
          </li>
          <li>
            <strong>Random</strong>: each round randomly rolls type-the-name or multiple choice.
          </li>
          <li>
            A Digimon is guessable when you hold its level and attribute keys, your DigiStorage has room,
            and (for most Digimon) you already caught an earlier form in its line; line starters need no
            prior catch. The <strong>Digidex</strong> highlights what is guessable right now.
          </li>
          <li>
            The <strong>Multiworld</strong> view shows the live feed: what you caught, what you shipped to
            other players, and what arrived for you.
          </li>
        </ul>
      </Section>

      <Section icon={<HelpCircle size={16} />} title="Good to know">
        <ul className="ml-4 flex list-disc flex-col gap-1">
          <li>
            <strong>Images are opt-in.</strong> Digipelago hosts no Digimon art. Silhouette and Random
            modes ask permission to fetch images from digi-api.com in your browser; they are cached on
            your device only.
          </li>
          <li>
            <strong>Your progress lives on the Archipelago server.</strong> Refresh, close the tab, or
            switch devices and reconnect: everything (catches, received items, eaten food) is restored.
          </li>
          <li>
            Stuck with nothing to guess? Your DigiStorage may be full or you may be missing keys. Both fix
            themselves as the multiworld sends you items; check the status cards at the top of the Play
            view.
          </li>
        </ul>
      </Section>
    </div>
  );
}
