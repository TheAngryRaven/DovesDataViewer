import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { MarkdownContent } from '@/components/MarkdownContent';
import { slugify, normalizeTags, collectTags, type BlogPost } from '@/lib/blogPosts';
import {
  fetchAllPostsAdmin,
  createPost,
  updatePost,
  deletePost,
  isDuplicateSlugError,
  type PostPatch,
} from '@/plugins/cloud-sync/postsClient';
import { Plus, Trash2, Edit2, Check, X, Sparkles } from 'lucide-react';

interface Draft {
  title: string;
  slug: string;
  slugDirty: boolean;
  body: string;
  tags: string[];
  aiAssisted: boolean;
  published: boolean;
}

const emptyDraft: Draft = {
  title: '',
  slug: '',
  slugDirty: false,
  body: '',
  tags: [],
  aiAssisted: false,
  published: false,
};

function draftFromPost(post: BlogPost): Draft {
  return {
    title: post.title,
    slug: post.slug,
    slugDirty: true, // an existing slug is a published URL — never auto-rewrite it
    body: post.body,
    tags: post.tags,
    aiAssisted: post.aiAssisted,
    published: post.published,
  };
}

export function UpdatesTab() {
  const { t } = useTranslation('admin');
  const { user } = useAuth();
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPosts(await fetchAllPostsAdmin());
    } catch (e: unknown) {
      toast({ title: t('common.error'), description: (e as Error).message, variant: 'destructive' });
    }
    setLoading(false);
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const saveError = (e: unknown) => {
    if (isDuplicateSlugError(e)) {
      toast({ title: t('updates.slugTaken'), variant: 'destructive' });
    } else {
      toast({ title: t('common.error'), description: (e as Error).message, variant: 'destructive' });
    }
  };

  const handleCreate = async (draft: Draft) => {
    if (!user) return;
    try {
      await createPost({
        slug: draft.slug,
        title: draft.title.trim(),
        body: draft.body,
        tags: draft.tags,
        aiAssisted: draft.aiAssisted,
        published: draft.published,
        publishedAt: draft.published ? new Date().toISOString() : null,
        authorId: user.id,
      });
      setShowAdd(false);
      toast({ title: t('updates.created') });
      load();
    } catch (e: unknown) {
      saveError(e);
    }
  };

  const handleUpdate = async (post: BlogPost, draft: Draft) => {
    try {
      const patch: PostPatch = {
        slug: draft.slug,
        title: draft.title.trim(),
        body: draft.body,
        tags: draft.tags,
        aiAssisted: draft.aiAssisted,
        published: draft.published,
      };
      // First publish stamps the date; unpublish/republish keeps the original.
      if (draft.published && !post.publishedAt) patch.publishedAt = new Date().toISOString();
      await updatePost(post.id, patch);
      setEditingId(null);
      toast({ title: t('updates.updated') });
      load();
    } catch (e: unknown) {
      saveError(e);
    }
  };

  const handleTogglePublished = async (post: BlogPost, published: boolean) => {
    try {
      const patch: PostPatch = { published };
      if (published && !post.publishedAt) patch.publishedAt = new Date().toISOString();
      await updatePost(post.id, patch);
      load();
    } catch (e: unknown) {
      toast({ title: t('common.error'), description: (e as Error).message, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deletePost(id);
      toast({ title: t('updates.deleted') });
      load();
    } catch (e: unknown) {
      toast({ title: t('common.error'), description: (e as Error).message, variant: 'destructive' });
    }
  };

  const allTags = collectTags(posts);

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-foreground">{t('updates.title')}</h3>
        <Button size="sm" onClick={() => { setShowAdd(!showAdd); setEditingId(null); }}>
          <Plus className="w-4 h-4 mr-1" /> {t('updates.addPost')}
        </Button>
      </div>

      {showAdd && (
        <PostEditor
          initial={emptyDraft}
          allTags={allTags}
          onSave={handleCreate}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {loading ? (
        <p className="text-muted-foreground">{t('common.loading')}</p>
      ) : posts.length === 0 ? (
        <p className="text-muted-foreground">{t('updates.none')}</p>
      ) : (
        <div className="space-y-2">
          {posts.map(post => (
            editingId === post.id ? (
              <PostEditor
                key={post.id}
                initial={draftFromPost(post)}
                allTags={allTags}
                onSave={draft => handleUpdate(post, draft)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div key={post.id} className="racing-card p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Switch
                    checked={post.published}
                    onCheckedChange={val => handleTogglePublished(post, val)}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-foreground truncate">{post.title}</span>
                      {post.aiAssisted && <Sparkles className="w-3.5 h-3.5 shrink-0 text-primary" />}
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded truncate">
                        /updates/{post.slug}
                      </span>
                      {post.tags.length > 0 && (
                        <span className="text-xs text-muted-foreground truncate">
                          {post.tags.join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost" size="icon" className="h-8 w-8"
                    onClick={() => { setEditingId(post.id); setShowAdd(false); }}
                  >
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                    onClick={() => handleDelete(post.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}

function PostEditor({ initial, allTags, onSave, onCancel }: {
  initial: Draft;
  allTags: string[];
  onSave: (draft: Draft) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation('admin');
  const [draft, setDraft] = useState<Draft>(initial);
  const [tagInput, setTagInput] = useState('');
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  const setTitle = (title: string) =>
    setDraft(d => ({ ...d, title, slug: d.slugDirty ? d.slug : slugify(title) }));

  const commitTag = () => {
    const tags = normalizeTags([...draft.tags, tagInput]);
    setDraft(d => ({ ...d, tags }));
    setTagInput('');
  };

  const removeTag = (tag: string) =>
    setDraft(d => ({ ...d, tags: d.tags.filter(x => x !== tag) }));

  const addExistingTag = (tag: string) =>
    setDraft(d => ({ ...d, tags: normalizeTags([...d.tags, tag]) }));

  const canSave = draft.title.trim() !== '' && slugify(draft.slug) !== '' && draft.body.trim() !== '';

  const handleSave = async () => {
    setSaving(true);
    try {
      // Normalize even when saving straight from the slug field (no blur yet).
      await onSave({ ...draft, slug: slugify(draft.slug) });
    } finally {
      setSaving(false);
    }
  };

  const suggestions = allTags.filter(tag => !draft.tags.includes(tag));

  return (
    <div className="racing-card p-4 space-y-3">
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <Label>{t('updates.fields.title')}</Label>
          <Input value={draft.title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div>
          <Label>{t('updates.fields.slug')}</Label>
          <Input
            value={draft.slug}
            className="font-mono"
            onChange={e => setDraft(d => ({ ...d, slug: e.target.value, slugDirty: true }))}
            onBlur={e => setDraft(d => ({ ...d, slug: slugify(e.target.value) }))}
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label>{t('updates.fields.body')}</Label>
          <div className="flex gap-1">
            <Button size="sm" variant={preview ? 'outline' : 'default'} onClick={() => setPreview(false)}>
              {t('updates.write')}
            </Button>
            <Button size="sm" variant={preview ? 'default' : 'outline'} onClick={() => setPreview(true)}>
              {t('updates.preview')}
            </Button>
          </div>
        </div>
        {preview ? (
          <div className="mt-2 rounded-md border border-border p-4 min-h-[200px]">
            <MarkdownContent source={draft.body} />
          </div>
        ) : (
          <Textarea
            value={draft.body}
            onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
            rows={14}
            className="mt-2 font-mono text-sm"
            placeholder={t('updates.bodyPlaceholder')}
          />
        )}
      </div>

      <div>
        <Label>{t('updates.fields.tags')}</Label>
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          {draft.tags.map(tag => (
            <Badge key={tag} variant="secondary" className="gap-1">
              {tag}
              <button type="button" onClick={() => removeTag(tag)} className="hover:text-destructive">
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
          <Input
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                commitTag();
              }
            }}
            onBlur={() => { if (tagInput.trim()) commitTag(); }}
            placeholder={t('updates.tagPlaceholder')}
            className="w-40 h-8"
          />
        </div>
        {suggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span className="text-xs text-muted-foreground">{t('updates.previouslyUsed')}</span>
            {suggestions.map(tag => (
              <button
                key={tag}
                type="button"
                onClick={() => addExistingTag(tag)}
                className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-primary/10"
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-2">
          <Switch
            checked={draft.aiAssisted}
            onCheckedChange={val => setDraft(d => ({ ...d, aiAssisted: val }))}
          />
          <Label>{t('updates.aiAssisted')}</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={draft.published}
            onCheckedChange={val => setDraft(d => ({ ...d, published: val }))}
          />
          <Label>{t('updates.published')}</Label>
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={!canSave || saving}>
          <Check className="w-4 h-4 mr-1" /> {t('updates.save')}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}><X className="w-4 h-4" /></Button>
      </div>
    </div>
  );
}
