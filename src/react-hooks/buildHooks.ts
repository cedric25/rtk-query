import { AnyAction, createSelector, ThunkAction, ThunkDispatch } from '@reduxjs/toolkit';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MutationSubState,
  QueryStatus,
  QuerySubState,
  RequestStatusFlags,
  SubscriptionOptions,
  QueryKeys,
  RootState,
} from '../core/apiState';
import {
  EndpointDefinitions,
  MutationDefinition,
  QueryDefinition,
  QueryArgFrom,
  ResultTypeFrom,
} from '../endpointDefinitions';
import { QueryResultSelectorResult, MutationResultSelectorResult, skipSelector } from '../core/buildSelectors';
import { QueryActionCreatorResult, MutationActionCreatorResult } from '../core/buildInitiate';
import { shallowEqual } from '../utils';
import { Api } from '../apiTypes';
import { Id, NoInfer, Override } from '../tsHelpers';
import { ApiEndpointMutation, ApiEndpointQuery, CoreModule, PrefetchOptions } from '../core/module';
import { ReactHooksModuleOptions } from './module';
import { useShallowStableValue } from './useShallowStableValue';
import { UninitializedValue, UNINITIALIZED_VALUE } from '../constants';

export interface QueryHooks<Definition extends QueryDefinition<any, any, any, any, any>> {
  useQuery: UseQuery<Definition>;
  useLazyQuery: UseLazyQuery<Definition>;
  useQuerySubscription: UseQuerySubscription<Definition>;
  useLazyQuerySubscription: UseLazyQuerySubscription<Definition>;
  useQueryState: UseQueryState<Definition>;
}

export interface MutationHooks<Definition extends MutationDefinition<any, any, any, any, any>> {
  useMutation: UseMutation<Definition>;
}

export type UseQuery<D extends QueryDefinition<any, any, any, any>> = <R = UseQueryStateDefaultResult<D>>(
  arg: QueryArgFrom<D>,
  options?: UseQuerySubscriptionOptions & UseQueryStateOptions<D, R>
) => UseQueryStateResult<D, R> & ReturnType<UseQuerySubscription<D>>;
interface UseQuerySubscriptionOptions extends SubscriptionOptions {
  skip?: boolean;
  refetchOnMountOrArgChange?: boolean | number;
}

export type UseQuerySubscription<D extends QueryDefinition<any, any, any, any>> = (
  arg: QueryArgFrom<D>,
  options?: UseQuerySubscriptionOptions
) => Pick<QueryActionCreatorResult<D>, 'refetch'>;

export type UseLazyQueryLastPromiseInfo<D extends QueryDefinition<any, any, any, any>> = {
  lastArg: QueryArgFrom<D>;
};
export type UseLazyQuery<D extends QueryDefinition<any, any, any, any>> = <R = UseQueryStateDefaultResult<D>>(
  options?: SubscriptionOptions & Omit<UseQueryStateOptions<D, R>, 'skip'>
) => [(arg: QueryArgFrom<D>) => void, UseQueryStateResult<D, R>, UseLazyQueryLastPromiseInfo<D>];

export type UseLazyQuerySubscription<D extends QueryDefinition<any, any, any, any>> = (
  options?: SubscriptionOptions
) => [(arg: QueryArgFrom<D>) => void, QueryArgFrom<D> | UninitializedValue];

export type QueryStateSelector<R, D extends QueryDefinition<any, any, any, any>> = (
  state: QueryResultSelectorResult<D>,
  lastResult: R | undefined,
  defaultQueryStateSelector: DefaultQueryStateSelector<D>
) => R;

export type DefaultQueryStateSelector<D extends QueryDefinition<any, any, any, any>> = (
  state: QueryResultSelectorResult<D>,
  lastResult: Pick<UseQueryStateDefaultResult<D>, 'data'>
) => UseQueryStateDefaultResult<D>;

export type UseQueryState<D extends QueryDefinition<any, any, any, any>> = <R = UseQueryStateDefaultResult<D>>(
  arg: QueryArgFrom<D>,
  options?: UseQueryStateOptions<D, R>
) => UseQueryStateResult<D, R>;

export type UseQueryStateOptions<D extends QueryDefinition<any, any, any, any>, R> = {
  skip?: boolean;
  selectFromResult?: QueryStateSelector<R, D>;
};

export type UseQueryStateResult<_ extends QueryDefinition<any, any, any, any>, R> = NoInfer<R>;

type UseQueryStateBaseResult<D extends QueryDefinition<any, any, any, any>> = QuerySubState<D> & {
  /**
   * Query has not started yet.
   */
  isUninitialized: false;
  /**
   * Query is currently loading for the first time. No data yet.
   */
  isLoading: false;
  /**
   * Query is currently fetching, but might have data from an earlier request.
   */
  isFetching: false;
  /**
   * Query has data from a successful load.
   */
  isSuccess: false;
  /**
   * Query is currently in "error" state.
   */
  isError: false;
};

type UseQueryStateDefaultResult<D extends QueryDefinition<any, any, any, any>> = Id<
  | Override<Extract<UseQueryStateBaseResult<D>, { status: QueryStatus.uninitialized }>, { isUninitialized: true }>
  | Override<
      UseQueryStateBaseResult<D>,
      | { isLoading: true; isFetching: boolean; data: undefined }
      | ({ isSuccess: true; isFetching: boolean; error: undefined } & Required<
          Pick<UseQueryStateBaseResult<D>, 'data' | 'fulfilledTimeStamp'>
        >)
      | ({ isError: true } & Required<Pick<UseQueryStateBaseResult<D>, 'error'>>)
    >
> & {
  /**
   * @deprecated will be removed in the next version
   * please use the `isLoading`, `isFetching`, `isSuccess`, `isError`
   * and `isUninitialized` flags instead
   */
  status: QueryStatus;
};

export type MutationStateSelector<R, D extends MutationDefinition<any, any, any, any>> = (
  state: MutationResultSelectorResult<D>,
  defaultMutationStateSelector: DefaultMutationStateSelector<D>
) => R;

export type DefaultMutationStateSelector<D extends MutationDefinition<any, any, any, any>> = (
  state: MutationResultSelectorResult<D>
) => UseMutationStateDefaultResult<D>;

export type UseMutationStateOptions<D extends MutationDefinition<any, any, any, any>, R> = {
  selectFromResult?: MutationStateSelector<R, D>;
};

type UseMutationStateBaseResult<D extends MutationDefinition<any, any, any, any>> = MutationSubState<D> & {
  /**
   * Mutation has not started yet.
   */
  isUninitialized: false;
  /**
   * Mutation is currently loading for the first time. No data yet.
   */
  isLoading: false;
  /**
   * Mutation has data from a successful load.
   */
  isSuccess: false;
  /**
   * Mutation is currently in "error" state.
   */
  isError: false;
};

type UseMutationStateDefaultResult<D extends MutationDefinition<any, any, any, any>> = Id<
  | Override<Extract<UseMutationStateBaseResult<D>, { status: QueryStatus.uninitialized }>, { isUninitialized: true }>
  | Override<
      UseMutationStateBaseResult<D>,
      | { isLoading: true; data: undefined }
      | ({ isSuccess: true; error: undefined } & Required<
          Pick<UseMutationStateBaseResult<D>, 'data' | 'fulfilledTimeStamp'>
        >)
      | ({ isError: true } & Required<Pick<UseMutationStateBaseResult<D>, 'error'>>)
    >
>;

export type UseMutation<D extends MutationDefinition<any, any, any, any>> = <R = UseMutationStateDefaultResult<D>>(
  options?: UseMutationStateOptions<D, R>
) => [
  (
    arg: QueryArgFrom<D>
  ) => {
    unwrap: () => Promise<ResultTypeFrom<D>>;
  },
  MutationSubState<D> & RequestStatusFlags
];

const defaultMutationStateSelector: DefaultMutationStateSelector<any> = (currentState) => {
  return currentState as UseMutationStateDefaultResult<any>;
};

const defaultQueryStateSelector: DefaultQueryStateSelector<any> = (currentState, lastResult) => {
  // data is the last known good request result we have tracked - or if none has been tracked yet the last good result for the current args
  const data = (currentState.isSuccess ? currentState.data : lastResult?.data) ?? currentState.data;

  // isFetching = true any time a request is in flight
  const isFetching = currentState.isLoading;
  // isLoading = true only when loading while no data is present yet (initial load with no data in the cache)
  const isLoading = !data && isFetching;
  // isSuccess = true when data is present
  const isSuccess = currentState.isSuccess || (isFetching && !!data);

  return { ...currentState, data, isFetching, isLoading, isSuccess } as UseQueryStateDefaultResult<any>;
};

/**
 * Wrapper around `defaultQueryStateSelector` to be used in `useQuery`.
 * We want the initial render to already come back with
 * `{ isUninitialized: false, isFetching: true, isLoading: true }`
 * to prevent that the library user has to do an additional check for `isUninitialized`/
 */
const noPendingQueryStateSelector: DefaultQueryStateSelector<any> = (currentState, lastResult) => {
  const selected = defaultQueryStateSelector(currentState, lastResult);
  if (selected.isUninitialized) {
    return {
      ...selected,
      isUninitialized: false,
      isFetching: true,
      isLoading: true,
      status: QueryStatus.pending,
    };
  }
  return selected;
};

type GenericPrefetchThunk = (
  endpointName: any,
  arg: any,
  options: PrefetchOptions
) => ThunkAction<void, any, any, AnyAction>;

/**
 *
 * @param opts.api - An API with defined endpoints to create hooks for
 * @param opts.moduleOptions.batch - The version of the `batchedUpdates` function to be used
 * @param opts.moduleOptions.useDispatch - The version of the `useDispatch` hook to be used
 * @param opts.moduleOptions.useSelector - The version of the `useSelector` hook to be used
 * @returns An object containing functions to generate hooks based on an endpoint
 */
export function buildHooks<Definitions extends EndpointDefinitions>({
  api,
  moduleOptions: { batch, useDispatch, useSelector },
}: {
  api: Api<any, Definitions, any, any, CoreModule>;
  moduleOptions: Required<ReactHooksModuleOptions>;
}) {
  return { buildQueryHooks, buildMutationHook, usePrefetch };

  function usePrefetch<EndpointName extends QueryKeys<Definitions>>(
    endpointName: EndpointName,
    defaultOptions?: PrefetchOptions
  ) {
    const dispatch = useDispatch<ThunkDispatch<any, any, AnyAction>>();
    const stableDefaultOptions = useShallowStableValue(defaultOptions);

    return useCallback(
      (arg: any, options?: PrefetchOptions) =>
        dispatch(
          (api.util.prefetchThunk as GenericPrefetchThunk)(endpointName, arg, { ...stableDefaultOptions, ...options })
        ),
      [endpointName, dispatch, stableDefaultOptions]
    );
  }

  function buildQueryHooks(name: string): QueryHooks<any> {
    const useQuerySubscription: UseQuerySubscription<any> = (
      arg: any,
      { refetchOnReconnect, refetchOnFocus, refetchOnMountOrArgChange, skip = false, pollingInterval = 0 } = {}
    ) => {
      const { initiate } = api.endpoints[name] as ApiEndpointQuery<
        QueryDefinition<any, any, any, any, any>,
        Definitions
      >;
      const dispatch = useDispatch<ThunkDispatch<any, any, AnyAction>>();
      const stableArg = useShallowStableValue(arg);
      const stableSubscriptionOptions = useShallowStableValue({
        refetchOnReconnect,
        refetchOnFocus,
        pollingInterval,
      });

      const promiseRef = useRef<QueryActionCreatorResult<any>>();

      useEffect(() => {
        if (skip) {
          return;
        }

        const lastPromise = promiseRef.current;
        const lastSubscriptionOptions = promiseRef.current?.subscriptionOptions;

        if (!lastPromise || lastPromise.arg !== stableArg) {
          lastPromise?.unsubscribe();
          const promise = dispatch(
            initiate(stableArg, {
              subscriptionOptions: stableSubscriptionOptions,
              forceRefetch: refetchOnMountOrArgChange,
            })
          );
          promiseRef.current = promise;
        } else if (stableSubscriptionOptions !== lastSubscriptionOptions) {
          lastPromise.updateSubscriptionOptions(stableSubscriptionOptions);
        }
      }, [dispatch, initiate, refetchOnMountOrArgChange, skip, stableArg, stableSubscriptionOptions]);

      useEffect(() => {
        return () => {
          promiseRef.current?.unsubscribe();
          promiseRef.current = undefined;
        };
      }, []);

      return useMemo(
        () => ({
          refetch: () => void promiseRef.current?.refetch(),
        }),
        []
      );
    };

    const useLazyQuerySubscription: UseLazyQuerySubscription<any> = ({
      refetchOnReconnect,
      refetchOnFocus,
      pollingInterval = 0,
    } = {}) => {
      const { initiate } = api.endpoints[name] as ApiEndpointQuery<
        QueryDefinition<any, any, any, any, any>,
        Definitions
      >;
      const dispatch = useDispatch<ThunkDispatch<any, any, AnyAction>>();

      const [arg, setArg] = useState<any>(UNINITIALIZED_VALUE);
      const promiseRef = useRef<QueryActionCreatorResult<any> | undefined>();

      const stableSubscriptionOptions = useShallowStableValue({
        refetchOnReconnect,
        refetchOnFocus,
        pollingInterval,
      });

      useEffect(() => {
        const lastSubscriptionOptions = promiseRef.current?.subscriptionOptions;

        if (stableSubscriptionOptions !== lastSubscriptionOptions) {
          promiseRef.current?.updateSubscriptionOptions(stableSubscriptionOptions);
        }
      }, [stableSubscriptionOptions]);

      const subscriptionOptionsRef = useRef(stableSubscriptionOptions);
      useEffect(() => {
        subscriptionOptionsRef.current = stableSubscriptionOptions;
      }, [stableSubscriptionOptions]);

      const trigger = useCallback(
        function (arg: any, preferCacheValue = false) {
          batch(() => {
            promiseRef.current?.unsubscribe();

            promiseRef.current = dispatch(
              initiate(arg, {
                subscriptionOptions: subscriptionOptionsRef.current,
                forceRefetch: !preferCacheValue,
              })
            );
            setArg(arg);
          });
        },
        [dispatch, initiate]
      );

      /* cleanup on unmount */
      useEffect(() => {
        return () => {
          promiseRef?.current?.unsubscribe();
        };
      }, []);

      /* if "cleanup on unmount" was triggered from a fast refresh, we want to reinstate the query */
      useEffect(() => {
        if (arg !== UNINITIALIZED_VALUE && !promiseRef.current) {
          trigger(arg, true);
        }
      }, [arg, trigger]);

      return useMemo(() => [trigger, arg], [trigger, arg]);
    };

    const useQueryState: UseQueryState<any> = (
      arg: any,
      { skip = false, selectFromResult = defaultQueryStateSelector as QueryStateSelector<any, any> } = {}
    ) => {
      const { select } = api.endpoints[name] as ApiEndpointQuery<QueryDefinition<any, any, any, any, any>, Definitions>;
      const stableArg = useShallowStableValue(arg);

      const lastValue = useRef<any>();

      const querySelector = useMemo(
        () =>
          createSelector(
            [select(skip ? skipSelector : stableArg), (_: any, lastResult: any) => lastResult],
            (subState, lastResult) => selectFromResult(subState, lastResult, defaultQueryStateSelector)
          ),
        [select, skip, stableArg, selectFromResult]
      );

      const currentState = useSelector(
        (state: RootState<Definitions, any, any>) => querySelector(state, lastValue.current),
        shallowEqual
      );

      useEffect(() => {
        lastValue.current = currentState;
      }, [currentState]);

      return currentState;
    };

    return {
      useQueryState,
      useQuerySubscription,
      useLazyQuerySubscription,
      useLazyQuery(options) {
        const [trigger, arg] = useLazyQuerySubscription(options);
        const queryStateResults = useQueryState(arg, {
          ...options,
          skip: arg === UNINITIALIZED_VALUE,
        });

        const info = useMemo(() => ({ lastArg: arg }), [arg]);
        return useMemo(() => [trigger, queryStateResults, info], [trigger, queryStateResults, info]);
      },
      useQuery(arg, options) {
        const querySubscriptionResults = useQuerySubscription(arg, options);
        const queryStateResults = useQueryState(arg, {
          selectFromResult: options?.skip ? undefined : (noPendingQueryStateSelector as QueryStateSelector<any, any>),
          ...options,
        });
        return useMemo(() => ({ ...queryStateResults, ...querySubscriptionResults }), [
          queryStateResults,
          querySubscriptionResults,
        ]);
      },
    };
  }

  function buildMutationHook(name: string): UseMutation<any> {
    return ({ selectFromResult = defaultMutationStateSelector as MutationStateSelector<any, any> } = {}) => {
      const { select, initiate } = api.endpoints[name] as ApiEndpointMutation<
        MutationDefinition<any, any, any, any, any>,
        Definitions
      >;
      const dispatch = useDispatch<ThunkDispatch<any, any, AnyAction>>();
      const [requestId, setRequestId] = useState<string>();

      const promiseRef = useRef<MutationActionCreatorResult<any>>();

      useEffect(() => {
        return () => {
          promiseRef.current?.unsubscribe();
          promiseRef.current = undefined;
        };
      }, []);

      const triggerMutation = useCallback(
        function (arg) {
          let promise: MutationActionCreatorResult<any>;
          batch(() => {
            promiseRef?.current?.unsubscribe();
            promise = dispatch(initiate(arg));
            promiseRef.current = promise;
            setRequestId(promise.requestId);
          });
          return promise!;
        },
        [dispatch, initiate]
      );

      const mutationSelector = useMemo(
        () =>
          createSelector([select(requestId || skipSelector)], (subState) =>
            selectFromResult(subState, defaultMutationStateSelector)
          ),
        [select, requestId, selectFromResult]
      );

      const currentState = useSelector(
        (state: RootState<Definitions, any, any>) => mutationSelector(state),
        shallowEqual
      );

      return useMemo(() => [triggerMutation, currentState], [triggerMutation, currentState]);
    };
  }
}
