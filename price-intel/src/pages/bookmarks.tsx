import { useGetBookmarks, useDeleteBookmark } from "@workspace/api-client-react";
import { Bookmark as BookmarkIcon, MapPin, Building, Trash2, ExternalLink, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Link } from "wouter";

export function Bookmarks() {
  const { data: bookmarks, isLoading } = useGetBookmarks({ query: { queryKey: ["/api/bookmarks"] } });
  const deleteMutation = useDeleteBookmark();
  const { toast } = useToast();

  const handleDelete = (id: number) => {
    deleteMutation.mutate({ id }, {
      onSuccess: () => toast({ title: "Bookmark removed" }),
      onError: () => toast({ title: "Failed to remove bookmark", variant: "destructive" }),
    });
  };

  return (
    <div className="p-8 h-full overflow-auto bg-muted/5">
      <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-500">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold ring-1 ring-primary/20">
            <BookmarkIcon className="w-3.5 h-3.5" />
            <span>Saved Providers</span>
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Bookmarks</h1>
          <p className="text-muted-foreground text-lg">Your saved healthcare providers.</p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{[1,2,3].map(i => <div key={i} className="glass-panel h-48 animate-pulse bg-muted/20" />)}</div>
        ) : !bookmarks || bookmarks.length === 0 ? (
          <div className="glass-panel max-w-3xl p-10 text-center flex flex-col items-center justify-center border border-border/40 shadow-xl">
            <div className="w-16 h-16 rounded-2xl bg-muted/40 flex items-center justify-center mb-5"><BookmarkIcon className="w-7 h-7 text-muted-foreground" /></div>
            <h3 className="text-xl font-bold text-foreground mb-2">No saved providers yet</h3>
            <p className="text-muted-foreground max-w-md">Save useful clinics from provider search so you can return to them without rebuilding the search.</p>
            <div className="flex gap-3 mt-6">
              <Link href="/" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold text-sm"><Search className="w-4 h-4" />Search providers</Link>
              <a href="/command-center?view=map" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 ring-1 ring-white/15 text-foreground font-semibold text-sm"><MapPin className="w-4 h-4" />Open map</a>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {bookmarks.map((bookmark) => (
              <div key={bookmark.id} className="glass-panel p-5 flex flex-col gap-4 border border-border/40 shadow-md hover:shadow-xl transition-all group relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/10 transition-colors" />
                <div className="relative z-10">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-bold text-lg leading-tight group-hover:text-primary transition-colors">{bookmark.providerName}</h3>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 -mt-1 -mr-1" onClick={() => handleDelete(bookmark.id)} disabled={deleteMutation.isPending}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="space-y-2 mt-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2"><Building className="w-4 h-4" /><span>{bookmark.providerType}</span></div>
                    <div className="flex items-center gap-2"><MapPin className="w-4 h-4" /><span>{bookmark.city}, {bookmark.stateRegion}</span></div>
                  </div>
                </div>
                <div className="mt-auto pt-4 border-t border-border/40 flex items-center justify-between relative z-10">
                  <span className="text-xs text-muted-foreground">Saved {format(new Date(bookmark.createdAt), "MMM d, yyyy")}</span>
                  <Button variant="ghost" size="sm" className="h-8 text-xs font-semibold text-primary">View Details <ExternalLink className="w-3 h-3 ml-1" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
