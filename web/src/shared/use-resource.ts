import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./api-client";

export type Resource<T> = {
  data: T | undefined;
  error: string | undefined;
  isLoading: boolean;
  reload: () => Promise<void>;
};

export function useResource<T>(load: () => Promise<T>, key: string): Resource<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(undefined);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    setData(undefined);
    void reload();
  }, [key, reload]);

  return { data, error, isLoading, reload };
}
