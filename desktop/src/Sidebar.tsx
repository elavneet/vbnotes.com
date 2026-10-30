import React, { useState } from 'react';
import { UNTAGGED, type Section, type TagNode } from '@/store/noteModel';
import { tagHue } from '@/utils/tags';
import { Icon, type IconName } from './Icon';
import { useSettingsOpen } from './Settings';
import { useNotes } from './store';

/** The library, in the phone's order: Notes, Untagged, the tag tree, Archive, Trash. */
export function Sidebar() {
  const { section, tag, counts, tags, show } = useNotes();
  const openSettings = useSettingsOpen((s) => s.set);
  const at = (s: Section, t = '') => section === s && tag === t;
  return (
    <nav className="sidebar">
      <div className="drag" data-tauri-drag-region />
      <Item icon="notes" label="Notes" count={counts.notes} active={at('notes')} onClick={() => show('notes')} />
      <Item icon="untagged" label="Untagged" count={counts.untagged} active={at('notes', UNTAGGED)} onClick={() => show('notes', UNTAGGED)} />
      {tags.length ? <h3 className="side-head">Tags</h3> : null}
      <div className="tags">
        {tags.map((n) => <TagRow key={n.path} node={n} depth={0} active={section === 'notes' ? tag : ''} onPick={(t) => show('notes', t)} />)}
      </div>
      <div className="side-bottom">
        <Item icon="archive" label="Archive" count={counts.archive} active={at('archive')} onClick={() => show('archive')} />
        <Item icon="trash" label="Trash" count={counts.trash} active={at('trash')} onClick={() => show('trash')} />
        <button className="item" onClick={() => openSettings(true)} title="Settings (⌘,)">
          <Icon name="settings" />
          <span className="item-label">Settings</span>
        </button>
      </div>
    </nav>
  );
}

function Item({ icon, label, count, active, onClick }: { icon: IconName; label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button className={`item${active ? ' active' : ''}`} onClick={onClick}>
      <Icon name={icon} />
      <span className="item-label">{label}</span>
      <span className="count">{count || ''}</span>
    </button>
  );
}

function TagRow({ node, depth, active, onPick }: { node: TagNode; depth: number; active: string; onPick: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const hue = tagHue(node.path);
  return (
    <>
      <div className={`item tag${active === node.path ? ' active' : ''}`} style={{ paddingLeft: 10 + depth * 14 }}>
        <button className={`fold${node.children.length ? '' : ' none'}${open ? ' open' : ''}`} onClick={() => setOpen(!open)} aria-label={open ? 'Fold' : 'Unfold'} tabIndex={node.children.length ? 0 : -1}>
          <Icon name="chevron" size={12} />
        </button>
        <button className="tag-name" onClick={() => onPick(node.path)}>
          <span className="vb-tag hash" data-hue={hue}>#</span>
          <span className="item-label">{node.name}</span>
          <span className="count">{node.count}</span>
        </button>
      </div>
      {open ? node.children.map((c) => <TagRow key={c.path} node={c} depth={depth + 1} active={active} onPick={onPick} />) : null}
    </>
  );
}
