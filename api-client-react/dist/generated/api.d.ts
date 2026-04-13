import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from "@tanstack/react-query";
import type { AdminDiagnostics, Bookmark, CreateBookmarkBody, ErrorResponse, ExportRequest, GetSearchHistoryParams, GetSearchSuggestionsParams, GetTopServicesParams, HealthStatus, PopularService, PriceResult, ProviderDetail, SearchHistoryItem, SearchRequest, SearchResponse, SearchSuggestion, SourceBreakdownItem, StatsSummary, TopService } from "./api.schemas";
import { customFetch } from "../custom-fetch";
import type { ErrorType, BodyType } from "../custom-fetch";
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
/**
 * Returns server health status
 * @summary Health check
 */
export declare const getHealthCheckUrl: () => string;
export declare const healthCheck: (options?: RequestInit) => Promise<HealthStatus>;
export declare const getHealthCheckQueryKey: () => readonly ["/api/healthz"];
export declare const getHealthCheckQueryOptions: <TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData> & {
    queryKey: QueryKey;
};
export type HealthCheckQueryResult = NonNullable<Awaited<ReturnType<typeof healthCheck>>>;
export type HealthCheckQueryError = ErrorType<unknown>;
/**
 * @summary Health check
 */
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * Search for posted self-pay prices across providers
 * @summary Search for healthcare prices
 */
export declare const getSearchPricesUrl: () => string;
export declare const searchPrices: (searchRequest: SearchRequest, options?: RequestInit) => Promise<SearchResponse>;
export declare const getSearchPricesMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof searchPrices>>, TError, {
        data: BodyType<SearchRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof searchPrices>>, TError, {
    data: BodyType<SearchRequest>;
}, TContext>;
export type SearchPricesMutationResult = NonNullable<Awaited<ReturnType<typeof searchPrices>>>;
export type SearchPricesMutationBody = BodyType<SearchRequest>;
export type SearchPricesMutationError = ErrorType<unknown>;
/**
 * @summary Search for healthcare prices
 */
export declare const useSearchPrices: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof searchPrices>>, TError, {
        data: BodyType<SearchRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof searchPrices>>, TError, {
    data: BodyType<SearchRequest>;
}, TContext>;
/**
 * @summary Get search autocomplete suggestions
 */
export declare const getGetSearchSuggestionsUrl: (params: GetSearchSuggestionsParams) => string;
export declare const getSearchSuggestions: (params: GetSearchSuggestionsParams, options?: RequestInit) => Promise<SearchSuggestion[]>;
export declare const getGetSearchSuggestionsQueryKey: (params?: GetSearchSuggestionsParams) => readonly ["/api/search/suggestions", ...GetSearchSuggestionsParams[]];
export declare const getGetSearchSuggestionsQueryOptions: <TData = Awaited<ReturnType<typeof getSearchSuggestions>>, TError = ErrorType<unknown>>(params: GetSearchSuggestionsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSearchSuggestions>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getSearchSuggestions>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetSearchSuggestionsQueryResult = NonNullable<Awaited<ReturnType<typeof getSearchSuggestions>>>;
export type GetSearchSuggestionsQueryError = ErrorType<unknown>;
/**
 * @summary Get search autocomplete suggestions
 */
export declare function useGetSearchSuggestions<TData = Awaited<ReturnType<typeof getSearchSuggestions>>, TError = ErrorType<unknown>>(params: GetSearchSuggestionsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSearchSuggestions>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get recent search history
 */
export declare const getGetSearchHistoryUrl: (params?: GetSearchHistoryParams) => string;
export declare const getSearchHistory: (params?: GetSearchHistoryParams, options?: RequestInit) => Promise<SearchHistoryItem[]>;
export declare const getGetSearchHistoryQueryKey: (params?: GetSearchHistoryParams) => readonly ["/api/search/history", ...GetSearchHistoryParams[]];
export declare const getGetSearchHistoryQueryOptions: <TData = Awaited<ReturnType<typeof getSearchHistory>>, TError = ErrorType<unknown>>(params?: GetSearchHistoryParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSearchHistory>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getSearchHistory>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetSearchHistoryQueryResult = NonNullable<Awaited<ReturnType<typeof getSearchHistory>>>;
export type GetSearchHistoryQueryError = ErrorType<unknown>;
/**
 * @summary Get recent search history
 */
export declare function useGetSearchHistory<TData = Awaited<ReturnType<typeof getSearchHistory>>, TError = ErrorType<unknown>>(params?: GetSearchHistoryParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSearchHistory>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get provider detail
 */
export declare const getGetProviderUrl: (id: number) => string;
export declare const getProvider: (id: number, options?: RequestInit) => Promise<ProviderDetail>;
export declare const getGetProviderQueryKey: (id: number) => readonly [`/api/providers/${number}`];
export declare const getGetProviderQueryOptions: <TData = Awaited<ReturnType<typeof getProvider>>, TError = ErrorType<ErrorResponse>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProvider>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getProvider>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetProviderQueryResult = NonNullable<Awaited<ReturnType<typeof getProvider>>>;
export type GetProviderQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Get provider detail
 */
export declare function useGetProvider<TData = Awaited<ReturnType<typeof getProvider>>, TError = ErrorType<ErrorResponse>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProvider>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get all prices for a provider
 */
export declare const getGetProviderPricesUrl: (id: number) => string;
export declare const getProviderPrices: (id: number, options?: RequestInit) => Promise<PriceResult[]>;
export declare const getGetProviderPricesQueryKey: (id: number) => readonly [`/api/providers/${number}/prices`];
export declare const getGetProviderPricesQueryOptions: <TData = Awaited<ReturnType<typeof getProviderPrices>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProviderPrices>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getProviderPrices>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetProviderPricesQueryResult = NonNullable<Awaited<ReturnType<typeof getProviderPrices>>>;
export type GetProviderPricesQueryError = ErrorType<unknown>;
/**
 * @summary Get all prices for a provider
 */
export declare function useGetProviderPrices<TData = Awaited<ReturnType<typeof getProviderPrices>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProviderPrices>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary List saved bookmarks
 */
export declare const getGetBookmarksUrl: () => string;
export declare const getBookmarks: (options?: RequestInit) => Promise<Bookmark[]>;
export declare const getGetBookmarksQueryKey: () => readonly ["/api/bookmarks"];
export declare const getGetBookmarksQueryOptions: <TData = Awaited<ReturnType<typeof getBookmarks>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getBookmarks>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getBookmarks>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetBookmarksQueryResult = NonNullable<Awaited<ReturnType<typeof getBookmarks>>>;
export type GetBookmarksQueryError = ErrorType<unknown>;
/**
 * @summary List saved bookmarks
 */
export declare function useGetBookmarks<TData = Awaited<ReturnType<typeof getBookmarks>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getBookmarks>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Save a provider bookmark
 */
export declare const getCreateBookmarkUrl: () => string;
export declare const createBookmark: (createBookmarkBody: CreateBookmarkBody, options?: RequestInit) => Promise<Bookmark>;
export declare const getCreateBookmarkMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createBookmark>>, TError, {
        data: BodyType<CreateBookmarkBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createBookmark>>, TError, {
    data: BodyType<CreateBookmarkBody>;
}, TContext>;
export type CreateBookmarkMutationResult = NonNullable<Awaited<ReturnType<typeof createBookmark>>>;
export type CreateBookmarkMutationBody = BodyType<CreateBookmarkBody>;
export type CreateBookmarkMutationError = ErrorType<unknown>;
/**
 * @summary Save a provider bookmark
 */
export declare const useCreateBookmark: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createBookmark>>, TError, {
        data: BodyType<CreateBookmarkBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createBookmark>>, TError, {
    data: BodyType<CreateBookmarkBody>;
}, TContext>;
/**
 * @summary Remove a bookmark
 */
export declare const getDeleteBookmarkUrl: (id: number) => string;
export declare const deleteBookmark: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteBookmarkMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteBookmark>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteBookmark>>, TError, {
    id: number;
}, TContext>;
export type DeleteBookmarkMutationResult = NonNullable<Awaited<ReturnType<typeof deleteBookmark>>>;
export type DeleteBookmarkMutationError = ErrorType<unknown>;
/**
 * @summary Remove a bookmark
 */
export declare const useDeleteBookmark: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteBookmark>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteBookmark>>, TError, {
    id: number;
}, TContext>;
/**
 * @summary Get dashboard summary statistics
 */
export declare const getGetStatsSummaryUrl: () => string;
export declare const getStatsSummary: (options?: RequestInit) => Promise<StatsSummary>;
export declare const getGetStatsSummaryQueryKey: () => readonly ["/api/stats/summary"];
export declare const getGetStatsSummaryQueryOptions: <TData = Awaited<ReturnType<typeof getStatsSummary>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getStatsSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getStatsSummary>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetStatsSummaryQueryResult = NonNullable<Awaited<ReturnType<typeof getStatsSummary>>>;
export type GetStatsSummaryQueryError = ErrorType<unknown>;
/**
 * @summary Get dashboard summary statistics
 */
export declare function useGetStatsSummary<TData = Awaited<ReturnType<typeof getStatsSummary>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getStatsSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get most searched services
 */
export declare const getGetTopServicesUrl: (params?: GetTopServicesParams) => string;
export declare const getTopServices: (params?: GetTopServicesParams, options?: RequestInit) => Promise<TopService[]>;
export declare const getGetTopServicesQueryKey: (params?: GetTopServicesParams) => readonly ["/api/stats/top-services", ...GetTopServicesParams[]];
export declare const getGetTopServicesQueryOptions: <TData = Awaited<ReturnType<typeof getTopServices>>, TError = ErrorType<unknown>>(params?: GetTopServicesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTopServices>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getTopServices>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetTopServicesQueryResult = NonNullable<Awaited<ReturnType<typeof getTopServices>>>;
export type GetTopServicesQueryError = ErrorType<unknown>;
/**
 * @summary Get most searched services
 */
export declare function useGetTopServices<TData = Awaited<ReturnType<typeof getTopServices>>, TError = ErrorType<unknown>>(params?: GetTopServicesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTopServices>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get price count by source type
 */
export declare const getGetSourceBreakdownUrl: () => string;
export declare const getSourceBreakdown: (options?: RequestInit) => Promise<SourceBreakdownItem[]>;
export declare const getGetSourceBreakdownQueryKey: () => readonly ["/api/stats/source-breakdown"];
export declare const getGetSourceBreakdownQueryOptions: <TData = Awaited<ReturnType<typeof getSourceBreakdown>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSourceBreakdown>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getSourceBreakdown>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetSourceBreakdownQueryResult = NonNullable<Awaited<ReturnType<typeof getSourceBreakdown>>>;
export type GetSourceBreakdownQueryError = ErrorType<unknown>;
/**
 * @summary Get price count by source type
 */
export declare function useGetSourceBreakdown<TData = Awaited<ReturnType<typeof getSourceBreakdown>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSourceBreakdown>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get crawl health and diagnostics
 */
export declare const getGetAdminDiagnosticsUrl: () => string;
export declare const getAdminDiagnostics: (options?: RequestInit) => Promise<AdminDiagnostics>;
export declare const getGetAdminDiagnosticsQueryKey: () => readonly ["/api/admin/diagnostics"];
export declare const getGetAdminDiagnosticsQueryOptions: <TData = Awaited<ReturnType<typeof getAdminDiagnostics>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAdminDiagnostics>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAdminDiagnostics>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAdminDiagnosticsQueryResult = NonNullable<Awaited<ReturnType<typeof getAdminDiagnostics>>>;
export type GetAdminDiagnosticsQueryError = ErrorType<unknown>;
/**
 * @summary Get crawl health and diagnostics
 */
export declare function useGetAdminDiagnostics<TData = Awaited<ReturnType<typeof getAdminDiagnostics>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAdminDiagnostics>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get popular service categories for browsing
 */
export declare const getGetPopularServicesUrl: () => string;
export declare const getPopularServices: (options?: RequestInit) => Promise<PopularService[]>;
export declare const getGetPopularServicesQueryKey: () => readonly ["/api/services/popular"];
export declare const getGetPopularServicesQueryOptions: <TData = Awaited<ReturnType<typeof getPopularServices>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPopularServices>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getPopularServices>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetPopularServicesQueryResult = NonNullable<Awaited<ReturnType<typeof getPopularServices>>>;
export type GetPopularServicesQueryError = ErrorType<unknown>;
/**
 * @summary Get popular service categories for browsing
 */
export declare function useGetPopularServices<TData = Awaited<ReturnType<typeof getPopularServices>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPopularServices>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Export search results as CSV
 */
export declare const getExportCsvUrl: () => string;
export declare const exportCsv: (exportRequest: ExportRequest, options?: RequestInit) => Promise<string>;
export declare const getExportCsvMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof exportCsv>>, TError, {
        data: BodyType<ExportRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof exportCsv>>, TError, {
    data: BodyType<ExportRequest>;
}, TContext>;
export type ExportCsvMutationResult = NonNullable<Awaited<ReturnType<typeof exportCsv>>>;
export type ExportCsvMutationBody = BodyType<ExportRequest>;
export type ExportCsvMutationError = ErrorType<unknown>;
/**
 * @summary Export search results as CSV
 */
export declare const useExportCsv: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof exportCsv>>, TError, {
        data: BodyType<ExportRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof exportCsv>>, TError, {
    data: BodyType<ExportRequest>;
}, TContext>;
export {};
//# sourceMappingURL=api.d.ts.map