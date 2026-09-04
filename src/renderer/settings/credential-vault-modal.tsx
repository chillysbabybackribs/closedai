import React, { useState, useEffect, type JSX } from 'react'
import { Plus, Key, Lock, Globe, Trash2, Copy, Eye, EyeOff, ArrowLeft, Check } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '../../components/ui/dialog.js'

export type Credential = {
  id: string
  name: string
  type: 'API Key' | 'Username/Password'
  url?: string
  username?: string
  secret: string
  createdAt: number
}

export type CredentialVaultModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CredentialVaultModal({ open, onOpenChange }: CredentialVaultModalProps): JSX.Element {
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [view, setView] = useState<'list' | 'add'>('list')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set())

  // Form State
  const [newType, setNewType] = useState<'API Key' | 'Username/Password'>('API Key')
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newUsername, setNewUsername] = useState('')
  const [newSecret, setNewSecret] = useState('')

  useEffect(() => {
    if (open) {
      const stored = localStorage.getItem('closedai-credentials')
      if (stored) {
        try {
          setCredentials(JSON.parse(stored))
        } catch {
          // ignore
        }
      }
      setView('list')
    }
  }, [open])

  useEffect(() => {
    localStorage.setItem('closedai-credentials', JSON.stringify(credentials))
  }, [credentials])

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const toggleReveal = (id: string) => {
    const next = new Set(revealedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setRevealedIds(next)
  }

  const handleDelete = (id: string) => {
    setCredentials((prev) => prev.filter((c) => c.id !== id))
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newSecret.trim()) return

    const newCred: Credential = {
      id: crypto.randomUUID(),
      type: newType,
      name: newName.trim() || 'Untitled Credential',
      url: newUrl.trim(),
      username: newUsername.trim(),
      secret: newSecret.trim(),
      createdAt: Date.now()
    }

    setCredentials((prev) => [newCred, ...prev])
    setView('list')
    
    // Reset form
    setNewType('API Key')
    setNewName('')
    setNewUrl('')
    setNewUsername('')
    setNewSecret('')
  }

  const getDomainFromUrl = (url: string) => {
    try {
      const u = new URL(url.startsWith('http') ? url : `https://${url}`)
      return u.hostname
    } catch {
      return null
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="appearance-dialog credential-dialog" aria-describedby="credential-description">
        {view === 'list' ? (
          <>
            <div className="appearance-dialog-heading">
              <div className="appearance-dialog-icon"><Key size={18} /></div>
              <div>
                <DialogTitle className="appearance-dialog-title">Credential Vault</DialogTitle>
                <DialogDescription id="credential-description">
                  Manage API keys and sensitive credentials used by the AI model.
                </DialogDescription>
              </div>
            </div>

            <div className="credential-list-content">
              <div className="credential-list-header flex items-center justify-between pb-2">
                <span className="text-sm font-medium">Your Credentials ({credentials.length})</span>
                <Button size="sm" onClick={() => setView('add')} className="h-8 gap-1">
                  <Plus size={14} /> Add new
                </Button>
              </div>

              {credentials.length === 0 ? (
                <div className="credential-empty-state">
                  <Lock className="credential-empty-icon" size={32} />
                  <p>No credentials stored yet.</p>
                  <span className="text-xs text-muted-foreground">Add an API key or account to get started.</span>
                </div>
              ) : (
                <div className="credential-list">
                  {credentials.map((cred) => {
                    const domain = cred.url ? getDomainFromUrl(cred.url) : null
                    const isRevealed = revealedIds.has(cred.id)

                    return (
                      <div key={cred.id} className="credential-item group">
                        <div className="credential-item-icon">
                          {domain ? (
                            <img src={`https://icons.duckduckgo.com/ip3/${domain}.ico`} alt="" className="w-6 h-6 rounded-sm" onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none'
                              ;(e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden')
                            }} />
                          ) : null}
                          <Globe className={domain ? "w-6 h-6 hidden text-muted-foreground" : "w-6 h-6 text-muted-foreground"} />
                        </div>
                        
                        <div className="credential-item-details">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">{cred.name}</span>
                            <span className="text-[10px] uppercase bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded-sm font-medium">
                              {cred.type}
                            </span>
                          </div>
                          
                          {cred.type === 'Username/Password' && cred.username && (
                            <div className="text-xs text-muted-foreground mt-0.5">
                              User: {cred.username}
                            </div>
                          )}
                          
                          <div className="credential-secret-row flex items-center gap-2 mt-1">
                            <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                              {isRevealed ? cred.secret : '•'.repeat(Math.min(cred.secret.length, 24))}
                            </span>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button type="button" onClick={() => toggleReveal(cred.id)} className="p-1 hover:bg-secondary rounded text-muted-foreground" title={isRevealed ? "Hide" : "Reveal"}>
                                {isRevealed ? <EyeOff size={13} /> : <Eye size={13} />}
                              </button>
                              <button type="button" onClick={() => handleCopy(cred.secret, cred.id)} className="p-1 hover:bg-secondary rounded text-muted-foreground" title="Copy secret">
                                {copiedId === cred.id ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="credential-item-actions">
                          <button type="button" onClick={() => handleDelete(cred.id)} className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors" title="Delete">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="appearance-dialog-heading">
              <Button variant="ghost" size="icon" className="appearance-dialog-icon h-8 w-8 !rounded-full p-0 border-0" onClick={() => setView('list')}>
                <ArrowLeft size={16} />
              </Button>
              <div>
                <DialogTitle className="appearance-dialog-title">Add Credential</DialogTitle>
                <DialogDescription>Store a new API key or account login.</DialogDescription>
              </div>
            </div>

            <form onSubmit={handleSave} className="credential-add-form pt-4">
              <div className="space-y-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Credential Type</label>
                  <div className="flex gap-2">
                    {(['API Key', 'Username/Password'] as const).map((t) => (
                      <Button
                        key={t}
                        type="button"
                        variant={newType === t ? 'default' : 'outline'}
                        className="flex-1"
                        onClick={() => setNewType(t)}
                      >
                        {t}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-2">
                  <label htmlFor="credName" className="text-sm font-medium">Name <span className="text-muted-foreground font-normal">(Optional)</span></label>
                  <input id="credName" value={newName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)} placeholder="e.g. Stripe Production Key" className="border-input placeholder:text-muted-foreground flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" />
                </div>

                <div className="grid gap-2">
                  <label htmlFor="credUrl" className="text-sm font-medium">Associated URL / Service <span className="text-muted-foreground font-normal">(Optional)</span></label>
                  <input id="credUrl" value={newUrl} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewUrl(e.target.value)} placeholder="e.g. stripe.com" className="border-input placeholder:text-muted-foreground flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" />
                </div>

                {newType === 'Username/Password' && (
                  <div className="grid gap-2">
                    <label htmlFor="credUser" className="text-sm font-medium">Username or Email</label>
                    <input id="credUser" value={newUsername} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewUsername(e.target.value)} placeholder="user@example.com" className="border-input placeholder:text-muted-foreground flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" />
                  </div>
                )}

                <div className="grid gap-2">
                  <label htmlFor="credSecret" className="text-sm font-medium">{newType === 'API Key' ? 'API Key / Secret Token' : 'Password'}</label>
                  <input 
                    id="credSecret" 
                    type="password"
                    value={newSecret} 
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewSecret(e.target.value)} 
                    placeholder="Enter the secret value..." 
                    className="border-input placeholder:text-muted-foreground flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm font-mono shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" 
                    required 
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 mt-6 border-t">
                <Button type="button" variant="ghost" onClick={() => setView('list')}>Cancel</Button>
                <Button type="submit" disabled={!newSecret.trim()}>Save Credential</Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
