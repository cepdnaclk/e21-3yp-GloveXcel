-- Updated SQL schema for doctor/patient signup + login requirements
-- Includes email and password_hash for authentication and auto-generated IDs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.hospitals (
  hospital_id character varying PRIMARY KEY,
  name character varying NOT NULL,
  location character varying
);

CREATE TABLE public.doctors (
  doctor_id character varying PRIMARY KEY DEFAULT ('DOC-' || replace(gen_random_uuid()::text, '-', '')),
  name character varying NOT NULL,
  email character varying NOT NULL UNIQUE,
  password_hash character varying NOT NULL,
  hospital_id character varying NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT doctors_hospital_id_fkey FOREIGN KEY (hospital_id) REFERENCES public.hospitals(hospital_id)
);

CREATE TABLE public.patients (
  patient_id character varying PRIMARY KEY DEFAULT ('PAT-' || replace(gen_random_uuid()::text, '-', '')),
  name character varying NOT NULL,
  age integer,
  email character varying NOT NULL UNIQUE,
  password_hash character varying NOT NULL,
  primary_hospital_id character varying NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT patients_primary_hospital_id_fkey FOREIGN KEY (primary_hospital_id) REFERENCES public.hospitals(hospital_id)
);

CREATE TABLE public.exercises (
  exercise_id character varying PRIMARY KEY,
  description text,
  level integer,
  target_reps integer NOT NULL,
  target_sets integer NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL
);

CREATE TABLE public.therapy_plans (
  plan_id character varying PRIMARY KEY,
  doctor_id character varying NOT NULL,
  patient_id character varying NOT NULL,
  exercise_id character varying NOT NULL,
  CONSTRAINT therapy_plans_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(doctor_id),
  CONSTRAINT therapy_plans_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(patient_id),
  CONSTRAINT therapy_plans_exercise_id_fkey FOREIGN KEY (exercise_id) REFERENCES public.exercises(exercise_id)
);

CREATE TABLE public.therapy_sessions (
  session_id character varying PRIMARY KEY,
  plan_id character varying NOT NULL,
  session_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  completed_reps integer,
  over_reps integer,
  under_reps integer,
  completed_sets integer,
  status character varying DEFAULT 'completed',
  CONSTRAINT therapy_sessions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.therapy_plans(plan_id)
);

CREATE TABLE public.doctor_patient_channel_requests (
  request_id character varying PRIMARY KEY DEFAULT ('REQ-' || replace(gen_random_uuid()::text, '-', '')),
  doctor_id character varying NOT NULL,
  patient_id character varying NOT NULL,
  status character varying NOT NULL DEFAULT 'pending',
  requested_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  responded_at timestamp without time zone,
  CONSTRAINT doctor_patient_channel_requests_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(doctor_id) ON DELETE CASCADE,
  CONSTRAINT doctor_patient_channel_requests_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(patient_id) ON DELETE CASCADE,
  CONSTRAINT doctor_patient_channel_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT doctor_patient_channel_requests_doctor_patient_unique UNIQUE (doctor_id, patient_id)
);

CREATE INDEX doctor_patient_channel_requests_doctor_status_idx
  ON public.doctor_patient_channel_requests (doctor_id, status);

CREATE INDEX doctor_patient_channel_requests_patient_status_idx
  ON public.doctor_patient_channel_requests (patient_id, status);
