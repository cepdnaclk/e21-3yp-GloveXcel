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
