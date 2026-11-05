import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

export const slug = s =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
export const escapeHTML = s =>
  String(s).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

// Canonical catalog built from config/cv.md, config/profile.yml and config/cv-content-policy.json.
// Every heading may carry a slot marker (<!-- slot: name -->) that ties it to a worksheet key
// (see src/cvgen/_cv-worksheet.mjs). Education copy is the **CV description:** line of each
// entry in config/cv.md; the renderer never hard-codes candidate facts.
export function loadCatalog(root) {
  const cv = readFileSync(join(root, 'config/cv.md'), 'utf8').replaceAll('\r\n', '\n');
  const profile = yaml.load(readFileSync(join(root, 'config/profile.yml'), 'utf8'));
  const policy = JSON.parse(readFileSync(join(root, 'config/cv-content-policy.json'), 'utf8'));
  const sections = {};
  for (const m of cv.matchAll(/^## (.+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)) sections[m[1]] = m[2];
  function entries(section) {
    return [
      ...(sections[section] || '').matchAll(/^### (.+)\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm),
    ].map(m => {
      const [title, organization = '', dates = ''] = m[1].split(' | ');
      const body = m[2].replace(/<!--\s*slot:\s*[\w-]+\s*-->[ \t]*\n?/g, '');
      return {
        id: slug(m[1]),
        title,
        organization,
        dates,
        heading: m[1],
        evidence: body.trim(),
        slot: m[2].match(/<!--\s*slot:\s*([\w-]+)\s*-->/)?.[1] || '',
        cv_description: body.match(/^\*\*CV description:\*\*\s*(.+)$/m)?.[1]?.trim() || '',
        badge:
          body.match(/(?:https?:\/\/)?github\.com\/[\w./-]+/)?.[0]?.replace(/^https?:\/\//, '') ||
          '',
      };
    });
  }
  const roles = entries('Professional Experience');
  for (const r of roles) r.required = policy.required_role_headings.includes(r.heading);
  for (const h of policy.required_role_headings)
    if (!roles.some(r => r.heading === h))
      throw new Error('Required role heading changed; update config/cv-content-policy.json: ' + h);
  const contact = Object.fromEntries(
    ['full_name', 'phone', 'email', 'linkedin', 'github', 'spoken_languages'].map(k => [
      k,
      String(profile.candidate?.[k] || ''),
    ]),
  );
  return { contact, roles, projects: entries('Projects'), education: entries('Education') };
}

export function renderHTML(a, c, template) {
  const e = escapeHTML;
  const section = (name, content) =>
    content ? `<div class="section"><div class="section-title">${name}</div>${content}</div>` : '';
  const contact = ['phone', 'email', 'linkedin', 'github', 'spoken_languages']
    .filter(k => c.contact[k])
    .map(k => {
      const value = c.contact[k];
      if (!['linkedin', 'github'].includes(k)) return `<span>${e(value)}</span>`;
      const url = new URL(/^https?:\/\//.test(value) ? value : 'https://' + value);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid contact URL');
      return `<a href="${e(url.href)}">${e(value.replace(/^https?:\/\//, ''))}</a>`;
    })
    .join('<span class="separator">|</span>');
  const header = `<div class="header avoid-break"><h1>${e(c.contact.full_name)}</h1><div class="header-gradient"></div><div class="contact-row">${contact}</div></div>`;
  // Canonical experience order, never model-selected reordering of employment dates.
  const roles = c.roles
    .map(r => {
      const v = a.roles.find(v => v.id === r.id);
      return !v.include
        ? ''
        : `<div class="job"><div class="job-header"><span class="job-company">${e(r.organization)}</span><span class="job-period">${e(r.dates)}</span></div><div class="job-role">${e(r.title)}</div><ul>${v.bullets.map(b => `<li>${e(b.text)}</li>`).join('')}</ul></div>`;
    })
    .join('');
  const projects = a.projects
    .filter(v => v.include)
    .map(v => {
      const p = c.projects.find(p => p.id === v.id);
      return `<div class="project"><div><span class="project-title">${e(p.title)}</span>${p.badge ? `<span class="project-badge">${e(p.badge)}</span>` : ''}</div><div class="project-desc">${e(v.description.text)}</div>${v.technologies.length ? `<div class="project-tech">${v.technologies.map(t => e(t.text)).join(' · ')}</div>` : ''}</div>`;
    })
    .join('');
  const education = c.education
    .map(
      d =>
        `<div class="edu-item"><div class="edu-header"><span class="edu-title">${e(d.title)} <span class="edu-org">· ${e(d.organization)}</span></span><span class="edu-year">${e(d.dates)}</span></div>${d.cv_description ? `<div class="edu-desc">${e(d.cv_description)}</div>` : ''}</div>`,
    )
    .join('');
  const skills =
    '<div class="skills-grid">' +
    a.skills
      .map(
        s =>
          `<div class="skill-item"><span class="skill-category">${e(s.category)}:</span> ${s.items.map(t => e(t.text)).join(', ')}</div>`,
      )
      .join('') +
    '</div>';
  const body =
    header +
    section('Professional Summary', `<div class="summary-text">${e(a.summary.text)}</div>`) +
    section(
      'Core Competencies',
      '<div class="competencies-grid">' +
        a.competencies.map(t => `<span class="competency-tag">${e(t.text)}</span>`).join('') +
        '</div>',
    ) +
    section('Work Experience', roles) +
    section('Projects', projects) +
    section('Education', education) +
    section('Skills', skills);
  return template
    .replace('{{TITLE}}', e(c.contact.full_name + ' — CV'))
    .replace('{{CONTENT}}', body);
}
